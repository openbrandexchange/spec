# Automating publishing

Publishing should happen by itself: your PIM, ERP, DAM or a shared folder already has the data and the photos. Pick the first recipe that fits. Everything here works against **any** OBX node, because it only uses the [Ingest API](ingest.md) and the [canonical import format](import-format.md).

| You have… | Use | Code needed |
|---|---|---|
| a CSV/zip export on a web address, SFTP server or S3/R2/MinIO bucket | [1. Scheduled pull import](#1-scheduled-pull-import-no-code) | none |
| a folder where exports land | [2. `obx watch`](#2-a-drop-folder-obx-watch) | none |
| a server or PC that runs nightly jobs | [3. cron / Task Scheduler](#3-cron-or-windows-task-scheduler) | one line |
| your exports in a Git repository | [4. GitHub Action](#4-github-action) | a YAML file |
| n8n, Make or Zapier | [5. HTTP steps](#5-n8n-make-zapier) | none (visual) |
| a developer connecting a PIM/ERP | [6. Direct API](#6-direct-api-for-developers) | small |

All recipes need two values from your portal's admin, **Automatic upload → Access keys → New key** (an *automatic upload key*; the API calls it an ingest token):

- `OBX_URL`: your node's address, for example `https://brands.kestrel.example`
- `OBX_TOKEN`: the token (starts with `obxi_`, shown once; store it as a secret)

Give each system its own token, so you can revoke one without breaking the others, and restrict it to the brands it publishes.

## The `obx` command-line tool

`obx` (from [obx-go](https://github.com/openbrandexchange/obx-go)) is a single program for Windows, macOS and Linux. It reads `OBX_URL` and `OBX_TOKEN` from the environment (or `--url` / `--token`).

```sh
obx login https://brands.kestrel.example           # once per computer: stores the upload key (or --token obxi_…)
obx info                                           # check the key, see limits, brands and languages
obx push ./export                                  # a folder with products.csv, optional assets.csv and the images
obx push --csv products.csv --images ./images      # a CSV and a folder (or zip) of images
obx push --package export.zip                      # one zip (products.csv + assets.csv + images)
obx push ./export --mirror                         # also unpublish what is no longer in the file
obx push ./export --dry-run                        # only check, change nothing
obx watch ./outbox                                 # keep publishing whatever lands in a folder
obx status [--job <id>]                            # recent uploads and their problems
obx logout                                         # forget the stored key
```

`--csv products.csv` also sends an `assets.csv` found in the same folder (an import without it resets image rights, embargo dates and AI labels to the node's defaults). Other `push` options: `--assets-csv <file>` (another assets file), `--language nl` (language of the plain `name`/`description` columns), `--no-wait` (start the job and exit), `--json` (machine-readable output). `obx <command> --help` lists everything.

For **retailers**, `obx pull https://brands.kestrel.example --out ./kestrel` mirrors a brand's catalog with an API key (`--client-id`/`--client-secret` or `OBX_CLIENT_ID`/`OBX_CLIENT_SECRET`): article data plus, by default, the `web` version of every image. `--renditions original,web,square,thumb` picks other versions (originals only when the brand allows them), and `--follow` keeps it up to date from the change feed.

What `obx push` does, so you know it is cheap to run often: it hashes every image, asks the node which ones it already has, uploads only new or changed images (large files resumably), generates web/square/thumb versions itself when the node needs that, and starts one import job with the CSV and an image manifest. Unchanged products and images cause no work at the node and no updates for retailers. It waits for the job and prints a summary; exit code `0` = all good, `2` = done but some rows had errors (listed), `1` = failed.

## 1. Scheduled pull import (no code)

In the admin: **Automatic upload → Scheduled imports → Add**.

- **Web address (HTTPS):** the URL of a `products.csv` or a package zip (`products.csv` + `assets.csv` + images). If it needs a login, add a header such as `Authorization: Bearer …` (stored encrypted, never shown again).
- **SFTP:** host, user, password or private key, and the folder with `products.csv` and the images. The server key is pinned on first connection.
- **S3-compatible bucket** (AWS S3, Cloudflare R2, MinIO, Backblaze …): endpoint, bucket, prefix and a read-only access key.

Choose how often (hourly, daily at a time, weekly, or manual), and **Upsert** (only add and update) or **Mirror** (also unpublish products that disappeared from the file; refused if more than half would disappear, so a broken export never empties your catalog). **Test connection** shows the files it would read. Each run shows counts and per-row errors; unchanged files are skipped.

## 2. A drop folder: `obx watch`

Let your PIM/ERP/DAM or a colleague save exports into a folder, and run:

```sh
export OBX_URL=https://brands.kestrel.example OBX_TOKEN=obxi_…
obx watch /data/outbox
```

It pushes whenever files in the folder change (after they have been quiet for a moment), and skips images that did not change. Keep it running as a service (systemd, launchd, a Windows service wrapper) or with the Docker image:

```sh
docker run -d --restart unless-stopped -e OBX_URL -e OBX_TOKEN -v /data/outbox:/outbox \
  ghcr.io/openbrandexchange/obx watch /outbox
```

## 3. cron or Windows Task Scheduler

Linux/macOS, every night at 02:30 (`crontab -e`):

```cron
30 2 * * * OBX_URL=https://brands.kestrel.example OBX_TOKEN=obxi_… /usr/local/bin/obx push --csv /exports/products.csv --images /exports/images >> /var/log/obx.log 2>&1
```

Windows (PowerShell, once):

```powershell
$action = New-ScheduledTaskAction -Execute "C:\Tools\obx.exe" -Argument "push --csv D:\Export\products.csv --images D:\Export\images"
$trigger = New-ScheduledTaskTrigger -Daily -At 2:30am
[Environment]::SetEnvironmentVariable("OBX_URL", "https://brands.kestrel.example", "Machine")
[Environment]::SetEnvironmentVariable("OBX_TOKEN", "obxi_…", "Machine")
Register-ScheduledTask -TaskName "Publish to OBX" -Action $action -Trigger $trigger -User "SYSTEM"
```

## 4. GitHub Action

Store `OBX_URL` and `OBX_TOKEN` as repository secrets, then add `.github/workflows/publish.yml`:

```yaml
name: Publish product content
on:
  push:
    branches: [main]
    paths: ["export/**"]
  schedule:
    - cron: "30 2 * * *"
  workflow_dispatch:
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: openbrandexchange/obx-go/push-action@v0
        with:
          url: ${{ secrets.OBX_URL }}
          token: ${{ secrets.OBX_TOKEN }}
          folder: export
```

The action installs `obx` and runs `obx push`; its other inputs are `csv`, `assets-csv`, `images`, `package`, `mirror`, `allow-mass-unpublish` and `version` (see [push-action/action.yml](https://github.com/openbrandexchange/obx-go/blob/main/push-action/action.yml)). Without the action, or in GitLab CI, Bitbucket Pipelines or Azure DevOps, install and run it yourself:

```sh
curl -fsSL https://github.com/openbrandexchange/obx-go/releases/latest/download/obx_linux_amd64.tar.gz | tar -xz obx
./obx push export
```

## 5. n8n, Make, Zapier

Use a plain **HTTP Request** step. Authentication: header `Authorization` = `Bearer obxi_…`.

1. **Product** (for example when a product changes in your PIM): method `PUT`, URL `{OBX_URL}/obx/v1/ingest/products/{style number}`, JSON body:
   ```json
   {"style_number": "KO-1001", "name": {"en": "Merino Crew Sweater", "nl": "Merino trui met ronde hals"},
    "item_type": "sweater", "season": "AW26", "materials": [{"part": "main", "fibers": [{"fiber": "merino_wool", "percentage": 100}]}]}
   ```
2. **Size / colour**: `PUT {OBX_URL}/obx/v1/ingest/variants/{GTIN}` with `{"product_external_id": "KO-1001", "gtin": "2000100101025", "color": {"code": "NVY", "name": {"en": "Navy"}}, "size": "M"}`.
3. **Image**: first `PUT {OBX_URL}/obx/v1/ingest/assets/KO-1001_NVY_1` with `{"product_external_id": "KO-1001", "color_code": "NVY", "role": "packshot", "view": "front", "position": 1}`, then `PUT {OBX_URL}/obx/v1/ingest/assets/KO-1001_NVY_1/files/original` with the **binary** file as body (n8n: "Send Binary Data"; Make: "Request content" = the file data; Zapier: Webhooks "Custom Request" with the file). On nodes that do not render images themselves (`GET {OBX_URL}/obx/v1/ingest` shows `"server_generated": false`) use `obx` (or the admin's Imports screen) instead: they make the web versions on your computer and upload them with the original. A scheduled import delivers originals only, so on such a node its images are served in their original size until the web versions are added.
4. **Take something offline**: `PATCH {OBX_URL}/obx/v1/ingest/products/KO-1001`, header `Content-Type: application/merge-patch+json`, body `{"status": "unpublished"}`.

Every call is safe to repeat: the same data twice changes nothing.

**Get told when things happen:** admin → Automatic upload → Notifications (webhooks), events `import_run.completed`, `ingest_job.completed`, `access_request.created` (a retailer asked for access). Point it at an n8n/Make/Zapier webhook trigger. Verify the `OBX-Webhook-Signature` header when you can ([protocol.md §9](protocol.md#9-webhooks-capability-webhooks)).

## 6. Direct API (for developers)

A connector typically keeps a hash of what it sent last time, and sends only changes, in batches:

```sh
URL="$OBX_URL/obx/v1/ingest"; AUTH="Authorization: Bearer $OBX_TOKEN"

# 1. Upload images the node does not have yet (content-addressed).
for f in images/*.jpg; do
  sha=$(shasum -a 256 "$f" | cut -d' ' -f1)
  curl -sf -I -H "$AUTH" "$URL/blobs/$sha" >/dev/null || \
    curl -sf -X PUT -H "$AUTH" -H 'Content-Type: image/jpeg' --data-binary @"$f" "$URL/blobs/$sha"
done

# 2. One batch of up to 1000 operations (NDJSON), processed in order.
cat > batch.ndjson <<'EOF'
{"op":"upsert","kind":"product","external_id":"KO-1001","data":{"style_number":"KO-1001","name":{"en":"Merino Crew Sweater"}}}
{"op":"upsert","kind":"variant","external_id":"2000100101025","data":{"product_external_id":"KO-1001","gtin":"2000100101025","color":{"code":"NVY"},"size":"M"}}
{"op":"upsert","kind":"asset","external_id":"KO-1001_NVY_1","data":{"product_external_id":"KO-1001","color_code":"NVY","role":"packshot","view":"front","position":1,"files":{"original":{"sha256":"<sha of KO-1001_NVY_1.jpg>"}}}}
{"op":"unpublish","kind":"product","external_id":"KO-0999"}
EOF
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/x-ndjson' -H "Idempotency-Key: nightly-$(date +%F)" \
     --data-binary @batch.ndjson "$URL/batch" | jq '.summary // .'
```

Or send the CSV as-is and let the node parse it:

```sh
curl -s -X POST -H "$AUTH" -F csv=@products.csv -F images=@images.zip \
     -F 'options={"mode":"upsert"};type=application/json' "$URL/imports"      # → job; poll $URL/jobs/<id>
```

Libraries: the Go SDK in [obx-go](https://github.com/openbrandexchange/obx-go) (`ingest` client with blob dedupe, multipart uploads, rendition generation and batching). Any HTTP client works; the contract is [`openapi/obx-ingest.yaml`](../openapi/obx-ingest.yaml).
