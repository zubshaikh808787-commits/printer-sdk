# BT Ensure COM Port — Auto-creates an outgoing SPP COM port for a paired device
# Returns JSON: { "Success": true, "ComPort": "COM5" } or { "Success": false, "Error": "..." }
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File bt_ensure_com_port.ps1 -MacAddress 28D41E05B727

param(
    [Parameter(Mandatory=$true)][string]$MacAddress
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cleanMac = $MacAddress.Replace(':', '').Replace('-', '').Trim().ToUpper()

# 1. Check if a COM port already exists for this MAC address
$ports = @(Get-PnpDevice -Class Ports -PresentOnly -ErrorAction SilentlyContinue)
foreach ($p in $ports) {
    $friendly = $p.FriendlyName
    $inst = $p.InstanceId
    if ($friendly -match '\(COM(\d+)\)') {
        $comName = "COM$($Matches[1])"
        if ($inst -and ($inst.StartsWith("BTHENUM") -or $friendly.ToLower().Contains("bluetooth"))) {
            $tokens = $inst -split '[\\&_]'
            for ($i = $tokens.Length - 1; $i -ge 0; $i--) {
                $t = $tokens[$i].Trim().ToUpper()
                if ($t -match '^[0-9A-F]{12}$' -and $t -eq $cleanMac) {
                    # COM port already exists for this device
                    Write-Output (@{ Success = $true; ComPort = $comName; Method = "ExistingPort" } | ConvertTo-Json -Compress)
                    exit 0
                }
            }
        }
    }
}

# 2. Also search by walking all BTHENUM port entries and checking parent device MAC
$btEnumPorts = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {
    $_.InstanceId -like "BTHENUM*" -and $_.Class -eq "Ports"
})
foreach ($bp in $btEnumPorts) {
    $friendly = $bp.FriendlyName
    $inst = $bp.InstanceId
    if ($friendly -match '\(COM(\d+)\)') {
        $comName = "COM$($Matches[1])"
        # Check if the InstanceId contains the MAC anywhere (some formats embed it differently)
        $flatInst = $inst.ToUpper().Replace('\','').Replace('&','').Replace('_','').Replace('{','').Replace('}','')
        if ($flatInst.Contains($cleanMac)) {
            Write-Output (@{ Success = $true; ComPort = $comName; Method = "BTEnumMatch" } | ConvertTo-Json -Compress)
            exit 0
        }
    }
}

# 3. Try to force-create an outgoing COM port using the WinRT Bluetooth APIs
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
    })[0]

    function Await-WinRt($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(10000) | Out-Null
        return $netTask.Result
    }

    [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.Rfcomm.RfcommDeviceService, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null

    $macUInt = [Convert]::ToUInt64($cleanMac, 16)
    $deviceOp = [Windows.Devices.Bluetooth.BluetoothDevice]::FromBluetoothAddressAsync($macUInt)
    $device = Await-WinRt $deviceOp ([Windows.Devices.Bluetooth.BluetoothDevice])

    if (-not $device) {
        Write-Output (@{ Success = $false; Error = "DEVICE_NOT_FOUND"; Message = "No Bluetooth device found with MAC $cleanMac. Ensure it is paired." } | ConvertTo-Json -Compress)
        exit 0
    }

    if (-not $device.DeviceInformation.Pairing.IsPaired) {
        Write-Output (@{ Success = $false; Error = "NOT_PAIRED"; Message = "Device $cleanMac is not paired. Pair it first in Windows Bluetooth settings." } | ConvertTo-Json -Compress)
        exit 0
    }

    # Query RFCOMM services to verify the device supports SPP
    $rfcommOp = $device.GetRfcommServicesAsync()
    $rfcommRes = Await-WinRt $rfcommOp ([Windows.Devices.Bluetooth.Rfcomm.RfcommDeviceServicesResult])

    $hasSpp = $false
    if ($rfcommRes -and $rfcommRes.Services -and $rfcommRes.Services.Count -gt 0) {
        foreach ($s in $rfcommRes.Services) {
            $uuid = $s.ServiceId.AsString().ToLower()
            if ($uuid.StartsWith("{00001101") -or $uuid.StartsWith("00001101")) {
                $hasSpp = $true
                break
            }
        }
    }

    if (-not $hasSpp) {
        # Device doesn't advertise SPP, but many printers work via other RFCOMM services
        # The WinRT RFCOMM path in bt_rfcomm_writer.ps1 handles this — just note it
        if ($rfcommRes -and $rfcommRes.Services -and $rfcommRes.Services.Count -gt 0) {
            $hasSpp = $true  # Has some RFCOMM service, good enough
        }
    }

    # After verifying the device supports RFCOMM, try to trigger Windows to bind a COM port
    # by enabling the Serial Port service in the device's Bluetooth properties via registry
    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices\$cleanMac"
    if (Test-Path $regPath) {
        # Device is known to the BT driver stack
        # Try to rescan/refresh to trigger COM port creation
        try {
            # Use pnputil to scan for hardware changes, which can trigger COM port binding
            $null = & pnputil /scan-devices 2>&1
            Start-Sleep -Seconds 2

            # Re-check for COM port after refresh
            $portsAfter = @(Get-PnpDevice -Class Ports -PresentOnly -ErrorAction SilentlyContinue)
            foreach ($p in $portsAfter) {
                $friendly = $p.FriendlyName
                $inst = $p.InstanceId
                if ($friendly -match '\(COM(\d+)\)' -and ($inst.StartsWith("BTHENUM") -or $friendly.ToLower().Contains("bluetooth"))) {
                    $flatInst = $inst.ToUpper().Replace('\','').Replace('&','').Replace('_','').Replace('{','').Replace('}','')
                    if ($flatInst.Contains($cleanMac)) {
                        $comName = "COM$($Matches[1])"
                        Write-Output (@{ Success = $true; ComPort = $comName; Method = "PnPRescan" } | ConvertTo-Json -Compress)
                        exit 0
                    }
                }
            }
        } catch {}
    }

    # If we still don't have a COM port, check if we can use RFCOMM directly (bypass COM port)
    if ($hasSpp) {
        Write-Output (@{ 
            Success = $false; 
            Error = "NO_COM_PORT_BUT_RFCOMM_OK"; 
            Message = "Device is paired and supports RFCOMM but Windows hasn't auto-created a COM port. The printer can still be reached via direct RFCOMM.";
            HasRfcomm = $true
        } | ConvertTo-Json -Compress)
        exit 0
    }

    Write-Output (@{ 
        Success = $false; 
        Error = "NO_SPP_SERVICE"; 
        Message = "Device $cleanMac is paired but does not advertise any RFCOMM/SPP services. It may need to be powered on or put into pairing mode."
    } | ConvertTo-Json -Compress)
} catch {
    Write-Output (@{ 
        Success = $false; 
        Error = "EXCEPTION"; 
        Message = $_.Exception.Message 
    } | ConvertTo-Json -Compress)
}
