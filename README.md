# Rai Community

Rai Community is a Windows app for coordinating community outreach on Holochain. Version 0.4.9 adds English and Turkish titles and descriptions for tasks. The app uses Holochain 0.7.1 and the existing 0.4.x network and profile.

[Windows downloads](https://github.com/RaiTurk/rai-community/releases) · [Volunteer node guide](ops/README.md)

## Build and validation

### Windows 0.4.1 (WebView2)

Build on Windows x64 with Node.js 24 and the Holochain 0.7.1 binaries. Prepare the pinned SDK and Node libraries with `tools/prepare-webview2.ps1`, build the hApp with `node tools/build.mjs`, then run `node tools/package-webview2.mjs`. Set `RAI_WINDOWS_NODE` to the reviewed Node 24.22.3 x64 executable when it is outside the shared tool cache. `RAI_WINDOWS_SIGNER` can point to the Holochain 0.700.1 Windows x64 signing addon. `RAI_MAKENSIS` can point to an installed NSIS compiler. The `--dir` option builds only the unpacked Windows release.

The Windows app uses the system WebView2 Evergreen Runtime. It opens the `org.raicommunity.next/0.4.x` profile using the existing local password and imports the former Electron UI settings into WebView2 on first open. Close the older app before switching. The 0.4.x network and hApp bundle carry over. Windows installation is per user and has its own Start menu shortcut. Uninstalling the WebView2 build keeps the encrypted profile in AppData.

To exercise two packaged WebView2 clients, a volunteer node, and the upgrade from an isolated Electron 0.4.0 profile, set `RAI_TEST_WEBVIEW2=1` and run `node tests/native-04.mjs`. That test uses the existing 0.4.0 unpacked Electron package for the upgrade fixture.

### Earlier pilot builds

Node.js 24+, Rust with wasm32-unknown-unknown, Holochain 0.7.1 CLI/runtime. Dependencies are pinned in Cargo.lock/package.json. This workspace currently reuses an existing verified toolchain/dependency cache through junctions; neither that other application nor the global machine toolchain is modified. Set `RAI_TOOLING_ROOT` to an appropriate cache containing `bin/hc`, `bin/holochain`, `bin/lair-keystore` and the pinned Kangaroo checkout for standalone packaging.

Without a system Node.js, `build-0.3.0.cmd` runs the same steps with Kangaroo's Electron in Node mode.

```
node tools/build.mjs
node --test tests/core.test.mjs tests/hosting-clock.test.mjs tests/x-account.test.mjs tests/v030.test.mjs
node --test tests/network.mjs tests/organizers.mjs tests/peers.mjs
node --test tests/adversarial.mjs tests/node-runtime.mjs
node tools/node-kit.mjs
node --test tests/kit.mjs
node tools/package-windows.mjs
node tests/native-ui.mjs
```

The adversarial test builds a test-only coordinator feature and replaces only its isolated cell's coordinator. The shipping build has no such entry point. Rebuild normally before copying build output; production bundles are generated only by `tools/build.mjs` without this feature. Tests use random network seeds and temporary workspace-owned profiles, never real X posts or actual user memberships. Native tests create encrypted desktop profiles and three separate app processes; no recovery codes are printed or stored by the UI test. Hidden-window screenshots are not part of its verification.

## Boundaries

- Integrity zome verifies record types, device authorship, Ed25519 recovery-root signatures, organizer powers, static role proofs, self-review restrictions, references and immutable indexing.
- Organizer permissions (0.3): the founder holds all of them and cannot be changed or removed. The founder grants others any of `tasks`, `goals`, `channels`, `reviewers`, `membership`, `sampling`, `hosting` with an `admin_grant` record (empty list revokes); only the founder grants. A delegated action carries `authority` = the author's grant, which integrity checks (founder-issued, names the author, lists the permission). Revocation is decided by the coordinator projection: an action counts only while its grant is the author's latest grant at the action's timestamp. Timestamps are author-claimed, so a revoked organizer could backdate within their own chain; accepted pilot limitation.
- Channels (0.3): `channel` records versioned by id; the latest version decides name, organizer-only writing and closing. Integrity checks the referenced channel version; the coordinator always points new messages at the latest version.
- Tasks (0.3): an empty `post_url` makes a task without an X link whose only action is `done`; claims on it take no X verification and may carry a note (≤1,000 characters). Description ≤10,000 characters.
- Hosting RaiUnyt (0.3, `raiunyt-rules-v2`, computed in the UI from public records): 1 per hour with at least one successful check by an active reviewer, per member; multiplied by the `hosting_policy` in force (default ×3 when one host was reachable that hour, ×2 for two). Campaign and hosting RaiUnyt are shown separately. Reviewer apps check every ~15 minutes, also when minimized.
- Coordinator and deterministic projection enforce current membership/device/role state, review assignment, recovery cutoffs and grouped campaign semantics. Global revocation cannot be inferred from a single old valid role record in immutable validation. A modified coordinator can append some statically valid old-role records; current views ignore revoked review authority. Do not describe every revoked write as rejected by immutable validation.
- Recovery code is an Ed25519 PKCS8 private key encoded for local backup. It is not encrypted by the app after export. Device keys are held by the password-protected native keystore. No organizer/social recovery or server secret copy exists. A signed old-device sequence cutoff excludes later raw writes from active history; unseen records beyond a user-accepted cutoff are a real recovery limitation.
- Sampling is deterministic and reproducible, based on identity/campaign, not secret adversary-resistant random selection or personhood proof. Joining is open; independent peer checks remain required for X account attestation. Open membership is not proof of one person per identity. Changing the policy affects new campaign groups. Flagged later report versions are included and assignment excludes the contributor.
- Host observations are trusted, signed observer attestations backed by the supplied runner's actual remote nonce call. They are not hardware-backed or continuous storage/uptime proofs; a malicious appointed observer can lie. No balance is stored in the schema; RaiUnyt is recomputed from records.
- Membership is open without an invitation; signed recovery-root proof still binds each device. 0.3 rejects invitation references. Network records remain public to peers with the bundle/seed. Revocation cannot erase downloaded data.
- Shared text chat: integrity enforces nonempty 1–1,000 character messages and device authorship. The normal coordinator enforces 5 seconds between writes; this is not an immutable rate limit or Sybil defense. UI escapes text, renders 50 messages initially and can show older messages; the current snapshot still loads all events, so this is not backend pagination.
- 0.3 is a fresh network by decision: no migration code and no `legacy` role. Everyone joins with a new identity; the founder recreates the community. Release 0.3 keeps the application ID `org.raicommunity.next`, so the installer replaces the 0.2 app; 0.2 data stays in its own `0.2.x/` folder. Desktop and headless kit both use the network seed `Rai Community-0.3.x`. (0.2 history: [the 0.2 upgrade guide](docs/UPGRADE-0.2-TR.md).)
- UI modules share one app. The `module` record (`module`, `version`, `kind`, `payload` ≤16,000 bytes, `admin` flag) lets later modules store data without a new network; module-specific rules then live in the coordinator/UI, not in integrity. The rest of the integrity schema is **not a guaranteed permanent extension API**. Adding/changing integrity rules changes DNA identity and needs explicit migration/redeployment design. UI/coordinator-only changes do not inherently change that identity. Production module separation and data migrations remain a release gate before a long-lived network is promised.
- No updater endpoint, signing certificate, private bootstrap/relay deployment, remote machine provisioning, Linux/Edge Node compatibility test, or physical redundancy test is included. Development connectivity services are defaults, configurable by operator. This is a reviewable local pilot, not a production availability claim.

Generated Windows installer and hashes are in `dist/`; standalone operator kit is `dist/node-kit-windows/`. Development caches, secrets/runtime profiles and generated binaries are excluded from Git. Keep them out of any source upload.
