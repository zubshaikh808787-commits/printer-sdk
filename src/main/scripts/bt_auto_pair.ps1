# BT Auto-Pair — Programmatic WinRT Bluetooth Pairing & Link Key Resync Script
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File bt_auto_pair.ps1 -MacAddress 28D41E05B727 -ForceRePair $true

param(
    [Parameter(Mandatory=$true)][string]$MacAddress,
    [Parameter(Mandatory=$false)][bool]$ForceRePair = $false
)

$ErrorActionPreference = 'SilentlyContinue'

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
    })[0]

    function Await-WinRt($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(12000) | Out-Null
        return $netTask.Result
    }

    [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    
    $cleanMac = $MacAddress.Replace(':', '').Replace('-', '').Trim().ToUpper()
    $macUInt = [Convert]::ToUInt64($cleanMac, 16)

    $deviceOp = [Windows.Devices.Bluetooth.BluetoothDevice]::FromBluetoothAddressAsync($macUInt)
    $device = Await-WinRt $deviceOp ([Windows.Devices.Bluetooth.BluetoothDevice])

    if (-not $device) {
        Write-Output "FAIL:DeviceNotFound"
        exit 0
    }

    $isPaired = $device.DeviceInformation.Pairing.IsPaired

    # If already paired and connected, verify connection capability
    if ($device.DeviceInformation.Pairing.IsPaired -and -not $ForceRePair -and $device.ConnectionStatus -eq [Windows.Devices.Bluetooth.BluetoothConnectionStatus]::Connected) {
        Write-Output "OK:AlreadyConnected"
        exit 0
    }

    # If paired but disconnected or forced, unpair first to obtain a fresh radio link session
    if ($device.DeviceInformation.Pairing.IsPaired) {
        $unpairOp = $device.DeviceInformation.Pairing.UnpairAsync()
        $unpairRes = Await-WinRt $unpairOp ([Windows.Devices.Enumeration.DeviceUnpairingResult])
        Start-Sleep -Milliseconds 1200
    }

    # Attempt custom pairing with auto-accepted thermal printer PINs
    $customPairing = $device.DeviceInformation.Pairing.Custom
    if ($customPairing) {
        $action = [Windows.Foundation.TypedEventHandler[Windows.Devices.Enumeration.DeviceInformationCustomPairing, Windows.Devices.Enumeration.DevicePairingRequestedEventArgs]]{
            param($sender, $args)
            if ($args.PairingKind -eq [Windows.Devices.Enumeration.DevicePairingKinds]::ProvidePin) {
                $args.Accept("0000")
            } elseif ($args.PairingKind -eq [Windows.Devices.Enumeration.DevicePairingKinds]::ConfirmOnly) {
                $args.Accept()
            }
        }
        $customPairing.add_PairingRequested($action)

        $pairKinds = [Windows.Devices.Enumeration.DevicePairingKinds]::ProvidePin -bor [Windows.Devices.Enumeration.DevicePairingKinds]::ConfirmOnly
        $pairOp = $customPairing.PairAsync($pairKinds, [Windows.Devices.Enumeration.DevicePairingProtectionLevel]::None)
        $pairRes = Await-WinRt $pairOp ([Windows.Devices.Enumeration.DevicePairingResult])

        if ($pairRes -and $pairRes.Status -eq [Windows.Devices.Enumeration.DevicePairingResultStatus]::Paired) {
            Write-Output "OK:PairedSuccessfully"
            exit 0
        } else {
            $statusStr = if ($pairRes) { $pairRes.Status.ToString() } else { "Unknown" }
            Write-Output "FAIL:PairingStatus_$statusStr"
            exit 0
        }
    }

    Write-Output "FAIL:CustomPairingUnavailable"
} catch {
    Write-Output "FAIL:Exception_$($_.Exception.Message)"
}
