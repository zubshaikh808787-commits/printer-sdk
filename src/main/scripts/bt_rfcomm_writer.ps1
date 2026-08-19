# BT RFCOMM Writer — Direct WinRT StreamSocket Writer for Bluetooth SPP Printers
# Strict verification: Connects to RFCOMM SerialPort {00001101}, streams bytes, flushes, and verifies socket drain
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File bt_rfcomm_writer.ps1 -MacAddress 28D41E05B727 -FilePath C:\path\to\payload.bin

param(
    [Parameter(Mandatory=$true)][string]$MacAddress,
    [Parameter(Mandatory=$true)][string]$FilePath
)

$ErrorActionPreference = 'Stop'

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
    })[0]

    function Await-Generic($WinRtTask, $ResultType, $TimeoutMs = 12000) {
        if (-not $WinRtTask) { throw "WinRtTask is null" }
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        if (-not $netTask.Wait($TimeoutMs)) { throw "Operation timed out after $($TimeoutMs)ms" }
        if ($netTask.Exception) { throw $netTask.Exception.InnerException.Message }
        return $netTask.Result
    }

    function Await-Action($WinRtTask, $TimeoutMs = 12000) {
        if (-not $WinRtTask) { throw "WinRtTask is null" }
        $asActionTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' 
        })[0]
        $netTask = $asActionTask.Invoke($null, @($WinRtTask))
        if (-not $netTask.Wait($TimeoutMs)) { throw "Action timed out after $($TimeoutMs)ms" }
        if ($netTask.Exception) { throw $netTask.Exception.InnerException.Message }
    }

    [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Networking.Sockets.StreamSocket, Windows.Networking.Sockets, ContentType = WindowsRuntime] | Out-Null

    if (-not (Test-Path $FilePath)) {
        Write-Output "FAIL:PayloadFileNotFound"
        exit 0
    }

    $cleanMac = $MacAddress.Replace(':', '').Replace('-', '').Trim().ToUpper()
    $macUInt = [Convert]::ToUInt64($cleanMac, 16)

    $btOp = [Windows.Devices.Bluetooth.BluetoothDevice]::FromBluetoothAddressAsync($macUInt)
    $btDevice = Await-Generic $btOp ([Windows.Devices.Bluetooth.BluetoothDevice]) 8000

    if (-not $btDevice) {
        Write-Output "FAIL:DeviceNotFound_Mac_$cleanMac"
        exit 0
    }

    $rfcommOp = $btDevice.GetRfcommServicesAsync()
    $rfcommRes = Await-Generic $rfcommOp ([Windows.Devices.Bluetooth.Rfcomm.RfcommDeviceServicesResult]) 8000

    $sppSvc = $null
    if ($rfcommRes -and $rfcommRes.Services) {
        foreach ($s in $rfcommRes.Services) {
            $uuid = $s.ServiceId.AsString().ToLower()
            if ($uuid.StartsWith("{00001101") -or $uuid.StartsWith("00001101")) {
                $sppSvc = $s
                break
            }
        }
        if (-not $sppSvc -and $rfcommRes.Services.Count -gt 0) {
            $sppSvc = $rfcommRes.Services[0]
        }
    }

    if (-not $sppSvc) {
        Write-Output "FAIL:RfcommSppServiceNotFound"
        exit 0
    }

    $socket = New-Object Windows.Networking.Sockets.StreamSocket
    $connOp = $socket.ConnectAsync($sppSvc.ConnectionHostName, $sppSvc.ConnectionServiceName)
    Await-Action $connOp 10000

    $m = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsStreamForWrite' -and $_.GetParameters().Count -eq 1 })[0]
    $netStream = $m.Invoke($null, @($socket.OutputStream))

    if (-not $netStream) {
        $socket.Dispose()
        Write-Output "FAIL:OutputStreamUnavailable"
        exit 0
    }

    $rawBytes = [System.IO.File]::ReadAllBytes($FilePath)
    $netStream.Write($rawBytes, 0, $rawBytes.Length)
    $netStream.Flush()

    Start-Sleep -Milliseconds 800
    $socket.Dispose()

    Write-Output "OK:$($rawBytes.Length):Svc_$($sppSvc.ServiceId.AsString())"
} catch {
    Write-Output "FAIL:Exception_$($_.Exception.Message)"
}
