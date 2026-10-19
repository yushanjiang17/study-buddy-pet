# To do

## Snip tool: macOS Screen Recording permission (open)

- **What happens:** clicking ✂ shows "I need permission to see your screen first", and **Electron** never appears in System Settings → Privacy & Security → Screen & System Audio Recording.
- **Likely cause:** in development the pet is started from Terminal (`npm start`), so macOS may count screen access against **Terminal**, not Electron. If permission was never asked, `desktopCapturer` returns an empty capture and the code reports `screen_permission`.
- **Things to try / fix:**
  1. Add **Terminal** with the ＋ button in that settings list, quit and reopen Terminal, restart the pet.
  2. If not enough, also add `app/node_modules/electron/dist/Electron.app` with ＋ (⌘⇧G to paste the path).
  3. Code: log `systemPreferences.getMediaAccessStatus('screen')` before and after `getSources` to see the real state.
  4. Code: change the in-app message to mention Terminal, and add a "Open Settings" button (`shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')`).
  5. Long term: a packaged app (electron-builder) has its own name in the list, so the permission is clear.
- Status: paused by request. Attach (📎) and paste (⌘V) both work.

## Later

- Canvas / Google Classroom: find assignments and worksheets automatically (paused).
- ~~Phase 4: Chrome extension + exam mode~~ done. Possible next: "explain this" right-click in Chrome; force-install the extension with Chrome policy so it can't be turned off.
- Proactive parent alerts (email) for urgent safety flags, now possible with the cloud server.
