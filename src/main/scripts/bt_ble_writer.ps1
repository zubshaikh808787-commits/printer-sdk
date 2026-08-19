# BT BLE Writer — Direct WinRT GATT Characteristic Writer for BLE Thermal Printers
# Strict verification: Checks GATT connectivity, service discovery, writable characteristics, chunked delivery, and response status
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File bt_ble_writer.ps1 -MacAddress 28D41E05B727 -FilePath C:\path\to\payload.bin

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

    function Await-WinRt($WinRtTask, $ResultType, $TimeoutMs = 12000) {
        if (-not $WinRtTask) { throw "WinRtTask is null" }
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        if (-not $netTask.Wait($TimeoutMs)) { throw "Operation timed out after $($TimeoutMs)ms" }
        if ($netTask.Exception) { throw $netTask.Exception.InnerException.Message }
        return $netTask.Result
    }

    [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.BluetoothCacheMode, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteResult, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.GenericAttributeProfile.GattSession, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null

    if (-not (Test-Path $FilePath)) {
        Write-Output "FAIL:PayloadFileNotFound"
        exit 0
    }

    $cleanMac = $MacAddress.Replace(':', '').Replace('-', '').Trim().ToUpper()
    $macUInt = [Convert]::ToUInt64($cleanMac, 16)

    # 1. Obtain BluetoothLE Device
    $leOp = [Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync($macUInt)
    $leDevice = Await-WinRt $leOp ([Windows.Devices.Bluetooth.BluetoothLEDevice]) 8000

    if (-not $leDevice) {
        Write-Output "FAIL:DeviceNotFound_Mac_$cleanMac"
        exit 0
    }

    # 2. Query GATT Services
    $servicesOp = $leDevice.GetGattServicesAsync([Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached)
    $servicesRes = Await-WinRt $servicesOp ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult]) 8000

    if ($servicesRes.Status -ne [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus]::Success) {
        Write-Output "FAIL:GattServicesUnreachable_Status_$($servicesRes.Status)_PleaseEnsurePrinterPoweredOnAndPaired"
        exit 0
    }

    # 3. Locate Print Service & Characteristic (0000ff00 / 0000ff02 or standard thermal printer GATT)
    $targetChar = $null
    $targetSvcUuid = ""
    $targetCharUuid = ""

    foreach ($svc in $servicesRes.Services) {
        $uuid = $svc.Uuid.ToString().ToLower()
        if ($uuid.StartsWith("0000ff00") -or $uuid.StartsWith("0000fee7") -or $uuid.StartsWith("000018f0") -or $uuid.StartsWith("e7810a71") -or $uuid.StartsWith("49535343")) {
            $charsOp = $svc.GetCharacteristicsAsync([Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached)
            $charsRes = Await-WinRt $charsOp ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult]) 5000
            if ($charsRes -and $charsRes.Characteristics) {
                foreach ($c in $charsRes.Characteristics) {
                    $cUuid = $c.Uuid.ToString().ToLower()
                    if ($cUuid.StartsWith("0000ff02") -or $cUuid.StartsWith("0000ff01") -or $cUuid.StartsWith("49535343-8841") -or 
                        $c.CharacteristicProperties.HasFlag([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicProperties]::Write) -or 
                        $c.CharacteristicProperties.HasFlag([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicProperties]::WriteWithoutResponse)) {
                        $targetChar = $c
                        $targetSvcUuid = $svc.Uuid.ToString()
                        $targetCharUuid = $c.Uuid.ToString()
                        break
                    }
                }
            }
            if ($targetChar) { break }
        }
    }

    if (-not $targetChar) {
        Write-Output "FAIL:NoWritableGattCharacteristicFound"
        exit 0
    }

    # 4. Resolve Write Method with Result Checking
    $writeOption = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteOption]::WriteWithoutResponse
    $writeMethod = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristic].GetMethod("WriteValueWithResultAsync", [Type[]]@([Windows.Storage.Streams.IBuffer], [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteOption]))
    if (-not $writeMethod) {
        $writeMethod = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristic].GetMethod("WriteValueAsync", [Type[]]@([Windows.Storage.Streams.IBuffer], [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteOption]))
    }
    if (-not $writeMethod) {
        $writeMethod = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristic].GetMethod("WriteValueWithResultAsync", [Type[]]@([Windows.Storage.Streams.IBuffer]))
    }

    $rawBytes = [System.IO.File]::ReadAllBytes($FilePath)
    $chunkSize = 20 # Standard BLE MTU safe payload limit
    $chunkIndex = 1
    $totalChunks = [Math]::Ceiling($rawBytes.Length / $chunkSize)

    for ($i = 0; $i -lt $rawBytes.Length; $i += $chunkSize) {
        $count = [Math]::Min($chunkSize, $rawBytes.Length - $i)
        $chunk = New-Object byte[] $count
        [Array]::Copy($rawBytes, $i, $chunk, 0, $count)

        $writer = New-Object Windows.Storage.Streams.DataWriter
        $writer.WriteBytes($chunk)
        $buffer = $writer.DetachBuffer()

        if ($writeMethod.GetParameters().Length -eq 2) {
            $writeOp = $writeMethod.Invoke($targetChar, @($buffer, $writeOption))
        } else {
            $writeOp = $writeMethod.Invoke($targetChar, @($buffer))
        }

        if ($writeMethod.ReturnType.Name -eq 'IAsyncOperation`1') {
            $writeRes = Await-WinRt $writeOp ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteResult]) 5000
            if ($writeRes.Status -ne [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus]::Success) {
                Write-Output "FAIL:ChunkWriteFailed_Chunk$($chunkIndex)Of$($totalChunks)_Status_$($writeRes.Status)"
                exit 0
            }
        } elseif ($writeMethod.ReturnType.Name -eq 'IAsyncAction') {
            $asActionTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
            $netTask = $asActionTask.Invoke($null, @($writeOp))
            if (-not $netTask.Wait(5000)) {
                Write-Output "FAIL:ChunkWriteTimeout_Chunk$($chunkIndex)Of$($totalChunks)"
                exit 0
            }
        }
        $chunkIndex++
        Start-Sleep -Milliseconds 25
    }

    # 5. Output Verified Success with Diagnostic Metadata
    Write-Output "OK:$($rawBytes.Length):Svc_$($targetSvcUuid):Char_$($targetCharUuid):Chunks_$($totalChunks)"
} catch {
    Write-Output "FAIL:Exception_$($_.Exception.Message)"
}
