using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class OrbitAudio
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class Enumerator {}

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IEnumerator
    {
        void EnumAudioEndpoints(int flow, int state, out IDevices devices);
        void GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDevices
    {
        void GetCount(out uint count);
        void Item(uint index, out IDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDevice
    {
        void Activate(ref Guid id, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object service);
        void OpenPropertyStore(int mode, out IProperties properties);
        void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid Format; public uint Id; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropertyValue
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Pointer;
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropertyValue value);

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IProperties
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropertyValue value);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IVolume
    {
        void RegisterControlChangeNotify(IntPtr callback);
        void UnregisterControlChangeNotify(IntPtr callback);
        void GetChannelCount(out uint count);
        void SetMasterVolumeLevel(float value, IntPtr context);
        void SetMasterVolumeLevelScalar(float value, IntPtr context);
        void GetMasterVolumeLevel(out float value);
        void GetMasterVolumeLevelScalar(out float value);
        void SetChannelVolumeLevel(uint channel, float value, IntPtr context);
        void SetChannelVolumeLevelScalar(uint channel, float value, IntPtr context);
        void GetChannelVolumeLevel(uint channel, out float value);
        void GetChannelVolumeLevelScalar(uint channel, out float value);
        void SetMute([MarshalAs(UnmanagedType.Bool)] bool value, IntPtr context);
        void GetMute([MarshalAs(UnmanagedType.Bool)] out bool value);
    }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    private class Policy {}

    // PolicyConfig is used only to select the Windows default render endpoint.
    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicy
    {
        void GetMixFormat();
        void GetDeviceFormat();
        void ResetDeviceFormat();
        void SetDeviceFormat();
        void GetProcessingPeriod();
        void SetProcessingPeriod();
        void GetShareMode();
        void SetShareMode();
        void GetPropertyValue();
        void SetPropertyValue();
        void SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    }

    private static void Release(object value)
    {
        if (value != null) Marshal.ReleaseComObject(value);
    }

    private static string ReadName(IDevice device)
    {
        IProperties properties;
        device.OpenPropertyStore(0, out properties);
        try
        {
            var key = new PropertyKey { Format = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), Id = 14 };
            PropertyValue value;
            properties.GetValue(ref key, out value);
            try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Pointer) : null; }
            finally { PropVariantClear(ref value); }
        }
        finally { Release(properties); }
    }

    private static Dictionary<string, string> Endpoints(IEnumerator enumerator)
    {
        IDevices devices;
        enumerator.EnumAudioEndpoints(0, 1, out devices);
        try
        {
            uint count;
            devices.GetCount(out count);
            var endpoints = new Dictionary<string, string>();
            for (uint i = 0; i < count; i++)
            {
                IDevice device;
                devices.Item(i, out device);
                try
                {
                    string id;
                    device.GetId(out id);
                    endpoints[id] = ReadName(device) ?? id;
                }
                finally { Release(device); }
            }
            return endpoints;
        }
        finally { Release(devices); }
    }

    public static object Update(string command, float level, string selected)
    {
        var enumerator = (IEnumerator)new Enumerator();
        try
        {
            var endpoints = Endpoints(enumerator);
            if (command == "select")
            {
                if (!endpoints.ContainsKey(selected)) throw new ArgumentException("Устройство отключено");
                var policy = (IPolicy)new Policy();
                try
                {
                    policy.SetDefaultEndpoint(selected, 0);
                    policy.SetDefaultEndpoint(selected, 1);
                }
                finally { Release(policy); }
            }
            if (endpoints.Count == 0) return new { endpoints = endpoints };
            IDevice device;
            enumerator.GetDefaultAudioEndpoint(0, 1, out device);
            try
            {
                string id;
                device.GetId(out id);
                var iid = typeof(IVolume).GUID;
                object service;
                device.Activate(ref iid, 23, IntPtr.Zero, out service);
                try
                {
                    var volume = (IVolume)service;
                    bool muted;
                    volume.GetMute(out muted);
                    if (command == "mute") volume.SetMute(!muted, IntPtr.Zero);
                    if (command == "level") volume.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(1, level)), IntPtr.Zero);
                    float current;
                    volume.GetMasterVolumeLevelScalar(out current);
                    volume.GetMute(out muted);
                    return new { id = id, endpoints = endpoints, level = (int)Math.Round(current * 100), muted = muted };
                }
                finally { Release(service); }
            }
            finally { Release(device); }
        }
        finally { Release(enumerator); }
    }
}
