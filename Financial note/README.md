# Financial Portfolio Web App

## Render deploy

Use these settings when creating a Render Web Service:

- Runtime: Node
- Root Directory: leave blank if this repository root contains `package.json`
- Build Command: `npm install`
- Start Command: `npm start`

The app expects these files/folders at the repository root:

- `package.json`
- `server.js`
- `public/`
- `data/`
- `scripts/`
- `Financial Portfolio .xlsx`

If Render says it cannot find `package.json`, the service root directory is pointed at the wrong folder or the file was not uploaded to GitHub.
