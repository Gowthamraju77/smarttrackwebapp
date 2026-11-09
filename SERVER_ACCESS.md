# Work through the shared server

Website: **http://10.162.237.183:8088/**

Shared project: **http://10.162.237.183:8088/shared/files/omnirush.ai/smarttrackwebapp/**

Both use port **8088** and start together with the host's sharing service.

1. Connect to the same Wi-Fi as the host and open that address in a browser.
2. The file browser opens without a username or password. If an old login screen
   remains, press Ctrl+F5 or use a private/incognito window.
3. Open a code/text file, edit it and save. Use New file/New folder, Rename,
   Copy/Move and Delete to manage the project.
4. Open the `smarttrackwebapp` folder and click **<> Toggle shell** to run commands.
   Commands run on the Windows host in the folder currently open in the browser.

Visitors automatically receive the existing friend account's read, create,
modify, rename, delete, download, command execution, administration and sharing
rights. Every device gets full File Browser permissions without signing in.
The owner account and new-account defaults also have full permissions.

Examples from the `smarttrackwebapp` folder:

```text
node --version
npm run typecheck
npm run build
node --test tests/heading.test.mjs tests/journey.test.mjs
```

The shared copy has host dependencies installed during packaging. After changing
dependency manifests, use `npm ci` on the host. Other devices do not need Node,
an editor or a project download for browser editing and host execution.

The shell is a command runner, not a persistent interactive terminal. Coordinate
edits and avoid starting concurrent builds in the same folder. Executed commands
use the host's Windows account and its filesystem permissions. Use your own
computer/Vercel dashboard for personal account login and deployment, as described
in [the deployment guide](docs/DEPLOYMENT.md).

The server must remain awake and on Wi-Fi. Its address may change after reconnecting.
The host's `Status-Server.ps1` in `%LOCALAPPDATA%/OmnirushShare` reports the current
link. Connection instructions are also in that private directory's `CONNECT.txt`.

The live shared folder is `C:\Users\muppa\omnirush.ai\smarttrackwebapp`.
The separate system copy is `C:\Users\muppa\smarttrackwebapp`.
They are independent snapshots, not automatically synchronized. The browser root
at http://10.162.237.183:8088/shared/ shows `omnirush.ai`, `omnirush.ai-server`, and
`smarttrackwebapp`. Select the appropriate folder to edit that copy directly.

Private `.local`, `.env*`, `.vercel` and account/configuration folders are hidden
by the existing file-browser rules. A safe `.env.example` template is included in
the downloadable archive, and its settings are also listed in the deployment
guide. These browser filters do not sandbox shell commands.
