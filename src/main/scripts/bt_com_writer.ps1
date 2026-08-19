# BT COM Writer — Multi-baud Win32 CreateFile/WriteFile script with auto-retry and multi-port fallback
# Usage: powershell -File bt_com_writer.ps1 -PortName COM4 -FilePath C:\path\to\payload.bin
param(
    [Parameter(Mandatory=$true)][string]$PortName,
    [Parameter(Mandatory=$true)][string]$FilePath
)

$csCode = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public class BtComWriterStandalone {
    const uint GENERIC_READ  = 0x80000000;
    const uint GENERIC_WRITE = 0x40000000;
    const uint OPEN_EXISTING = 3;
    const uint FILE_ATTRIBUTE_NORMAL = 0x80;

    const uint SETDTR = 5;
    const uint SETRTS = 3;

    [StructLayout(LayoutKind.Sequential)]
    public struct DCB {
        public int DCBlength, BaudRate, fBitFields;
        public short wReserved, XonLim, XoffLim;
        public byte ByteSize, Parity, StopBits, XonChar, XoffChar, ErrorChar, EofChar, EvtChar;
        public short wReserved1;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct COMMTIMEOUTS {
        public int ReadIntervalTimeout, ReadTotalTimeoutMultiplier, ReadTotalTimeoutConstant;
        public int WriteTotalTimeoutMultiplier, WriteTotalTimeoutConstant;
    }

    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern IntPtr CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetCommState(IntPtr h, ref DCB d);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetCommState(IntPtr h, ref DCB d);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetCommTimeouts(IntPtr h, ref COMMTIMEOUTS t);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool PurgeComm(IntPtr h, uint f);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool EscapeCommFunction(IntPtr h, uint f);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool WriteFile(IntPtr h, byte[] b, uint n, out uint w, IntPtr o);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool FlushFileBuffers(IntPtr h);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);

    public static string WriteToCom(string portName, byte[] data) {
        if (string.IsNullOrEmpty(portName)) return "FAIL:Empty port";
        string clean = System.Text.RegularExpressions.Regex.Replace(portName, @"[^A-Za-z0-9]", "");
        string path = @"\\.\" + clean;

        IntPtr h = new IntPtr(-1);
        int lastErr = 0;

        // Bluetooth connection retry loop: up to 5 attempts with 1000ms pause to allow Windows Bluetooth RFCOMM paging
        for (int attempt = 1; attempt <= 5; attempt++) {
            h = CreateFile(path, GENERIC_READ | GENERIC_WRITE, 0, IntPtr.Zero,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
            if (h != new IntPtr(-1)) {
                break;
            }
            lastErr = Marshal.GetLastWin32Error();
            Thread.Sleep(1000);
        }

        if (h == new IntPtr(-1))
            return "FAIL:CreateFile error " + lastErr + " path=" + path;

        // Configure serial: 115200 baud, 8N1
        DCB dcb = new DCB();
        dcb.DCBlength = Marshal.SizeOf(dcb);
        if (GetCommState(h, ref dcb)) {
            dcb.BaudRate = 115200;
            dcb.ByteSize = 8;
            dcb.Parity = 0;
            dcb.StopBits = 0;
            dcb.fBitFields = 1 | 0x10 | 0x1000; // fBinary | DTR_ENABLE | RTS_ENABLE
            SetCommState(h, ref dcb);
        }

        // Assert DTR and RTS lines for Bluetooth transceiver handshake
        EscapeCommFunction(h, SETDTR);
        EscapeCommFunction(h, SETRTS);

        // Timeouts
        COMMTIMEOUTS to = new COMMTIMEOUTS();
        to.WriteTotalTimeoutConstant = 5000;
        to.WriteTotalTimeoutMultiplier = 10;
        to.ReadIntervalTimeout = -1;
        SetCommTimeouts(h, ref to);

        // Purge buffers before sending
        PurgeComm(h, 12); // PURGE_TXCLEAR | PURGE_RXCLEAR

        // Write data
        uint written = 0;
        bool ok = WriteFile(h, data, (uint)data.Length, out written, IntPtr.Zero);
        if (!ok) {
            int e = Marshal.GetLastWin32Error();
            CloseHandle(h);
            return "FAIL:WriteFile error " + e;
        }

        FlushFileBuffers(h);

        // Drain delay to ensure Bluetooth RFCOMM packet queue empties to printer MCU
        Thread.Sleep(2500);

        CloseHandle(h);
        return "OK:" + written;
    }
}
'@

try { Add-Type -TypeDefinition $csCode -ErrorAction SilentlyContinue } catch {}
$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$result = [BtComWriterStandalone]::WriteToCom($PortName, $bytes)
Write-Output $result
