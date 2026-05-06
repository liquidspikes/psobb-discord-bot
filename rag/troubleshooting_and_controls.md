# Phantasy Star Online Blue Burst (PSOBB) Client Troubleshooting & Controller Setup Guide

## 1. Controller Configuration

PSOBB is a legacy game that natively uses **DirectInput**. Modern controllers often use XInput, which can cause the game to ignore analog triggers (LT/RT) entirely.

### General Rule for ALL Controllers:
**Connect your controller BEFORE launching the game.** PSOBB rarely recognizes controllers plugged in mid-session.

### Setting up PlayStation Controllers (PS4/PS5 DualShock/DualSense)
PlayStation controllers natively output DirectInput, which makes them generally compatible out-of-the-box, but third-party tools are sometimes required if Windows gets confused.
1. Connect your PlayStation controller via Bluetooth or USB.
2. Launch PSOBB and press **F12** (or the Home key) to open the Main Menu.
3. Navigate to **Options > Pad Button Config**.
4. Select **Custom** to map your Action Palette, Menu Decide/Cancel, and Camera controls.
*Note: If your PS controller is not being recognized at all, or if you are using DS4Windows, ensure DS4Windows is set to emulate a **DualShock 4** profile (DirectInput) rather than an Xbox 360 profile, otherwise you will run into the Xbox trigger bug below.*

### Setting up Xbox Controllers (Xbox One / Series X|S)
Xbox controllers use XInput. PSOBB will recognize the face buttons, but the Left and Right Triggers (LT/RT) will share the same axis or not work at all. You MUST use a wrapper to fix this.
1. Download a tool called **XInputPlus**.
2. Run it as Administrator and target your PSOBB executable (online.exe or psobb.exe).
3. Go to the **DirectInput** tab and check **Enable DirectInput Output**.
4. In the LT/RT dropdown menus, map them to **Buttons 11 and 12**.
5. Click **Apply**.
6. Launch PSOBB, open the Main Menu (F12) > **Options > Pad Button Config**, and you will now be able to map LT and RT correctly.

### Setting up via Steam Input (Alternative for Any Controller)
If you launch the game through Steam, you can bypass all of the above:
1. Add PSOBB as a **Non-Steam Game**.
2. Right-click it in your Library -> Properties -> Controller -> **Enable Steam Input**.
3. Use the Controller Layout tool to map your physical controller buttons directly to keyboard keystrokes (e.g., mapping your triggers to the keyboard keys you use for the Action Palette).

*Tip: Press **F11** in-game to toggle between "Keyboard Mode" (typing immediately chats) and "Gamepad Mode" (you must press Spacebar to open the chat box). Gamepad Mode is highly recommended for controller users to prevent accidentally opening menus while fighting.*

---

## 2. Common Client Crashes & Troubleshooting

PSOBB clients often conflict with modern Windows features. If your game is crashing, especially in Windowed Mode, follow these steps:

### DirectX Runtime Updates
As a baseline troubleshooting step for any crashing issues, especially on fresh Windows installations, always ensure you have the latest **DirectX End-User Runtime Web Installer** downloaded and installed from Microsoft: https://www.microsoft.com/en-us/download/details.aspx?id=35
PSOBB relies on legacy DirectX libraries that are not always included by default in modern Windows updates.

### The "Screen Dimming" Crash (Direct3D Device Lost)
If your game crashes whenever a Windows Administrator prompt pops up or the screen dims:
1. Open the Windows Start Menu and search for **Change User Account Control settings**.
2. Lower the slider by one notch to **"Notify me only when apps try to make changes to my computer (do not dim my desktop)"**.
3. This prevents Windows from altering the display state, which fatally crashes older Direct3D applications.

### The DEP Crash (Random Exits)
Data Execution Prevention (DEP) frequently kills the PSOBB client without warning.
1. Search Windows for **View advanced system settings**.
2. Under the Advanced tab, click Settings under Performance.
3. Go to the **Data Execution Prevention** tab.
4. Select **"Turn on DEP for essential Windows programs and services only"**.
5. Alternatively, add the PSOBB executable to the DEP exception list.

### Windowed Mode Instability
If standard "Windowed" mode is unstable or crashing:
1. In your Launcher Options, switch the display mode to **Virtual Fullscreen** (Borderless Window).
2. Ensure the in-game resolution matches your native desktop resolution.

### Graphics API Wrapper (Direct3D 11/12)
Older Direct3D 8/9 calls can cause crashes on modern GPUs (Nvidia RTX 3000/4000 or AMD RX series).
* If your launcher has a graphics API setting, change it from Direct3D 9 to **Direct3D 11** or **Direct3D 12**.
* This often utilizes a wrapper (like dgVoodoo2) under the hood, translating the old graphics calls into modern, stable ones. *Avoid "Direct3D 9on12" as it is often unstable.*

### Scaling / Tiny Window Issues
If the game window appears microscopic on a 4K monitor:
1. Right-click your PSOBB executable and select **Properties**.
2. Go to the **Compatibility** tab and click **Change high DPI settings**.
3. Check the box for **Override high DPI scaling behavior** and set it to **Application**.