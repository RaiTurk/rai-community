// When Electron runs as Node (no system Node), CLIs using yargs' hideBin
// treat it as a packaged app and misread argv. Mark it as the default app.
if (process.versions.electron && !process.defaultApp) process.defaultApp = true;
