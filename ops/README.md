# Volunteer node pilot

This is an optional always-on operator kit for **this hApp**, not a Holo Hosting account, Edge Node installer, or browser gateway. Windows x64 is the tested runtime. Node.js 24+ is required for this operator kit; ordinary desktop members use the installer and do not need Node.js. Holochain 0.7.1 and hc are included. The application code is bundled; no npm install is needed.

Do not reuse a personal desktop membership on this node. Create a separate node identity, so recovery does not revoke your desktop device. A machine must stay awake and online to answer checks. Closing the desktop app or stopping the operator runner stops that device's service. Windows will still store encrypted local data; take normal disk and account precautions.

## Enroll once

Run PowerShell in the extracted kit folder. Read the recovery warning first: **if the device and secret recovery code are both lost, nobody, including the organizer, can recover membership. Anyone with the code can take over the identity.**

```powershell
$env:RAI_ACK_RECOVERY_LOSS = 'YES'
./start-node.ps1 prepare 'D:/private-backup/node-recovery.txt'
```

Use an existing private folder. The command refuses to overwrite a file and prints only your public membership ID. Keep the secret file in an offline backup/password manager and share only the public ID with the organizer. The file is plaintext; Windows permissions must restrict access. Never put it in a public/shared folder, chat, Git, or X post.

Ask for a separate invitation code for this node. If the founder has opened joining, you can use the public community address instead. Use a fresh `runtime/` directory when moving from a 0.3.x kit to 0.4.x.

```powershell
$env:RAI_NODE_LABEL = 'My volunteer node'
./start-node.ps1 join 'RAI-INVITE.…' 'D:/private-backup/node-recovery.txt'
$env:RAI_ACK_RESOURCE_USE = 'YES'
./start-node.ps1 offer
./start-node.ps1 run
```

Use the same local password for every command on this profile. It encrypts this machine's keystore and differs from the recovery code. Keep `runtime/` private. In production service management, supply the password through a protected service credential mechanism; do not store it in the script. `run` does not require the recovery file. Ctrl+C stops it. To opt out, run `./start-node.ps1 withdraw`. `status` shows synchronized counts.

## Measurement

The founder or an authorized checker sends a remote challenge to a different enrolled node. The host signs its response, the checker signs the verified hour, and the host publishes a summary about every six hours. Failed checks stay local. Offering service does not require becoming a checker.

These sampled observations are **not continuous uptime, bytes stored, full DHT redundancy, proof of different physical people, or an SLA**. Authorized observers are trusted witnesses; a modified observer can lie. Multiple independent operators and incident review are required before relying on these figures.

RaiUnyt: a verified hosting hour earns 1 RaiUnyt per member, with the configured scarcity multiplier. A verified full-copy hour earns an additional 3 RaiUnyt without a multiplier. RaiUnyt is calculated from public records and is non-transferable.

## Recovery and connectivity

Use a new private runtime directory on a replacement device. Run `recover <recovery-file> [public-community-address]`. The first attempt shows synchronized prior-device record count and asks for `RAI_CONFIRM_HISTORY_READY=YES`; inspect/wait for history first, then deliberately confirm. The recovery root signs a cutoff for the old device. Records unseen at that cutoff cannot be promised as recoverable. Recovery does not restore private local data or bypass membership revocation.

Default seed: `Rai Community-0.4.x`, the same as the 0.4 desktop app. The kit keeps a full copy (`target_arc_factor: 1`); set `RAI_FULL_COPY=0` for a light node. Join with an invitation code (`RAI-INVITE.…`) unless the founder opened the community. Peers must use the same seed and integrity version. Default discovery/relay uses public Holochain **development** infrastructure. This kit does not yet supply independent bootstrap/relay deployment or production redundancy. `RAI_NETWORK_SEED`, `RAI_BOOTSTRAP_URL` and `RAI_RELAY_URL` allow an operator to configure appropriate services. Do not expose admin/app ports to the Internet; authenticated interfaces are bound locally.

The source runner is portable in principle using compatible `RAI_HC_BIN`/`RAI_HOLOCHAIN_BIN` paths. macOS, Linux, Edge Node and Docker deployment have not been validated by this pilot. No remote machine is provisioned by these files. This is an optional operator workflow; everyone else can participate through the Windows app.
