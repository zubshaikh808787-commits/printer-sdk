# BT Discovery Script — Robust PnP and COM Port Discovery with Adapter Status
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ── 1. Bluetooth Adapter Status Check ──
$adapterStatus = "UNKNOWN"
$btRadios = @(Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue | Where-Object {
    $_.FriendlyName -and (
        $_.FriendlyName.ToLower().Contains("bluetooth radio") -or
        $_.FriendlyName.ToLower().Contains("bluetooth adapter") -or
        $_.FriendlyName.ToLower().Contains("wireless bluetooth") -or
        $_.FriendlyName.ToLower().Contains("generic bluetooth") -or
        $_.InstanceId -like "USB\VID_*" -or
        $_.InstanceId -like "PCI\VEN_*"
    )
})

if ($btRadios.Count -eq 0) {
    # Check if there are ANY Bluetooth class devices at all (even non-present)
    $anyBt = @(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object {
        $_.FriendlyName -and (
            $_.FriendlyName.ToLower().Contains("bluetooth radio") -or
            $_.FriendlyName.ToLower().Contains("bluetooth adapter") -or
            $_.FriendlyName.ToLower().Contains("wireless bluetooth") -or
            $_.FriendlyName.ToLower().Contains("generic bluetooth")
        )
    })
    if ($anyBt.Count -gt 0) {
        $adapterStatus = "PRESENT_BUT_DISABLED"
    } else {
        # Last check: some adapters don't have "radio" in the name
        $anyBtDevice = @(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue)
        if ($anyBtDevice.Count -gt 0) {
            $adapterStatus = "PRESENT_AND_ENABLED"
        } else {
            $adapterStatus = "NOT_PRESENT"
        }
    }
} else {
    # Adapter present — check if it's actually enabled (Status = OK)
    $enabledRadio = $btRadios | Where-Object { $_.Status -eq 'OK' }
    if ($enabledRadio) {
        $adapterStatus = "PRESENT_AND_ENABLED"
    } else {
        $adapterStatus = "PRESENT_BUT_DISABLED"
    }
}

# ── 2. Enumerate Paired Bluetooth Devices ──
$btDevices = @(
    Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue
    Get-PnpDevice -Class BTHLEDevice -PresentOnly -ErrorAction SilentlyContinue
)

$ports = @(
    Get-PnpDevice -Class Ports -PresentOnly -ErrorAction SilentlyContinue
)

# ── 3. Build MAC → COM Port Map (improved: multiple resolution strategies) ──
$macToPort = @{}

foreach ($p in $ports) {
    $friendly = $p.FriendlyName
    if ($friendly -match '\(COM(\d+)\)') {
        $comName = "COM$($Matches[1])"
        $inst = $p.InstanceId

        # Skip non-Bluetooth ports
        if (-not ($inst.StartsWith("BTHENUM") -or $friendly.ToLower().Contains("bluetooth") -or $friendly.ToLower().Contains("serial over"))) {
            continue
        }

        # Strategy 1: Direct 12-hex MAC token in InstanceId
        $tokens = $inst -split '[\\&_]'
        $foundMac = $false
        for ($i = $tokens.Length - 1; $i -ge 0; $i--) {
            $t = $tokens[$i].Trim().ToUpper()
            if ($t -match '^[0-9A-F]{12}$') {
                $macToPort[$t] = $comName
                $foundMac = $true
                break
            }
        }

        # Strategy 2: MAC embedded within longer tokens (e.g. LOCALMFG&000E&ADDR_28D41E05B727)
        if (-not $foundMac) {
            $flatInst = $inst.ToUpper()
            $macMatch = [regex]::Match($flatInst, '([0-9A-F]{12})')
            if ($macMatch.Success) {
                $candidate = $macMatch.Groups[1].Value
                # Exclude well-known UUIDs (SPP UUID starts with 00001101)
                if (-not $candidate.StartsWith("000011") -and -not $candidate.StartsWith("000018") -and -not $candidate.StartsWith("0000FF") -and -not $candidate.StartsWith("00805F")) {
                    $macToPort[$candidate] = $comName
                    $foundMac = $true
                }
            }
        }

        # Strategy 3: Query parent device for MAC via registry
        if (-not $foundMac -and $inst.StartsWith("BTHENUM")) {
            try {
                $parentProp = Get-PnpDeviceProperty -InstanceId $inst -KeyName "DEVPKEY_Device_Parent" -ErrorAction SilentlyContinue
                if ($parentProp -and $parentProp.Data) {
                    $parentId = $parentProp.Data.ToString().ToUpper()
                    $parentTokens = $parentId -split '[\\&_]'
                    for ($j = $parentTokens.Length - 1; $j -ge 0; $j--) {
                        $pt = $parentTokens[$j].Trim().ToUpper()
                        if ($pt -match '^[0-9A-F]{12}$' -and -not $pt.StartsWith("000011") -and -not $pt.StartsWith("000018") -and -not $pt.StartsWith("0000FF") -and -not $pt.StartsWith("00805F")) {
                            $macToPort[$pt] = $comName
                            break
                        }
                    }
                }
            } catch {}
        }
    }
}

# ── 4. Build Device List ──
$results = @()
$seen = @{}

foreach ($d in $btDevices) {
    $name = $d.FriendlyName
    if ([string]::IsNullOrWhiteSpace($name)) { continue }

    $lower = $name.ToLower()
    if ($lower.Contains("personal area network") -or 
        $lower.Contains("rfcomm protocol tdi") -or 
        $lower.Contains("enumerator") -or 
        $lower.Contains("bluetooth le generic attribute") -or
        $lower.Contains("device information service") -or
        $lower -eq "bluetooth radio" -or 
        $lower.Contains("generic bluetooth") -or
        $lower.Contains("wireless bluetooth adapter") -or
        $lower.Contains("microsoft bluetooth")) {
        continue
    }

    $inst = $d.InstanceId
    $mac = $null
    $tokens = $inst -split '[\\&_]'
    for ($i = $tokens.Length - 1; $i -ge 0; $i--) {
        $t = $tokens[$i].Trim().ToUpper()
        if ($t -match '^[0-9A-F]{12}$' -and $t -ne "000000000000" -and -not $t.StartsWith("000011") -and -not $t.StartsWith("000018") -and -not $t.StartsWith("0000FF") -and -not $t.StartsWith("00805F")) {
            $mac = $t
            break
        }
    }

    $key = if ($mac) { $mac } else { $inst }
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true

    $port = if ($mac -and $macToPort.ContainsKey($mac)) { $macToPort[$mac] } else { $null }

    $results += [PSCustomObject]@{
        Name       = $name
        InstanceId = $inst
        Address    = $mac
        ComPort    = $port
        Status     = $d.Status
    }
}

# ── 5. Also surface Bluetooth COM ports whose parent was not directly listed (excluding dummy 000000000000) ──
foreach ($p in $ports) {
    $friendly = $p.FriendlyName
    if ($friendly -match '\(COM(\d+)\)') {
        $comName = "COM$($Matches[1])"
        $inst = $p.InstanceId
        if ($inst.StartsWith("BTHENUM") -or $friendly.ToLower().Contains("bluetooth")) {
            $mac = $null
            $tokens = $inst -split '[\\&_]'
            for ($i = $tokens.Length - 1; $i -ge 0; $i--) {
                $t = $tokens[$i].Trim().ToUpper()
                if ($t -match '^[0-9A-F]{12}$' -and $t -ne "000000000000" -and -not $t.StartsWith("000011") -and -not $t.StartsWith("000018") -and -not $t.StartsWith("0000FF") -and -not $t.StartsWith("00805F")) {
                    $mac = $t
                    break
                }
            }

            # Only add if it's not a generic dummy device and has a real MAC
            if ($mac -and -not $seen.ContainsKey($mac)) {
                $seen[$mac] = $true
                $results += [PSCustomObject]@{
                    Name       = $friendly
                    InstanceId = $inst
                    Address    = $mac
                    ComPort    = $comName
                    Status     = $p.Status
                }
            }
        }
    }
}

# ── 6. Output as JSON with adapter status envelope ──
$output = [PSCustomObject]@{
    AdapterStatus = $adapterStatus
    Devices       = @($results)
}

$output | ConvertTo-Json -Depth 3 -Compress
