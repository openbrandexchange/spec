# OBX in 10 minutes

For a **retailer's developer** who wants a brand's products, sizes, EANs and final images in a shop, PIM or ERP. You need `curl` and `jq`, and nothing else. Everything here is the [OBX Protocol](protocol.md), the part of OBX that every brand's portal speaks. The Ingest API, the import format and the admin API are for the brand's side and you do not need them.

The examples use the fictional brand portal `https://brands.kestrel.example` and its test catalog ([`fixtures/kestrel`](../fixtures/kestrel)).

## 1. Discovery: what does this brand offer?

```sh
HOST=https://brands.kestrel.example
curl -s $HOST/.well-known/obx | jq '{obx_version, api_base, token: .auth.token_endpoint, capabilities, brands: [.brands[].name]}'
```

The [discovery document](../schemas/DiscoveryDocument.json) is public. It tells you the API address (`api_base`, always ending in `/obx/v1`), where to get a token, where to request access, and which optional parts the portal offers (`exports`, `webhooks`, ...). Ignore capabilities you do not know.

## 2. Access: get an API key

No key yet? Ask the brand in its portal ("Request access", tick API access), or from code ([protocol.md §4.1](protocol.md#41-access-requests)):

```sh
curl -s -X POST $HOST/obx/v1/access-requests -H 'Content-Type: application/json' \
     -d @fixtures/examples/AccessRequestInput.example.json        # → 202 with id and request_token (shown once)
```

Poll `GET /obx/v1/access-requests/{id}` with `Authorization: Bearer <request_token>` at most once a minute. After the brand approves, the **first** read returns the `client_id` and `client_secret`; store them, because they are never shown again.

## 3. Token

```sh
TOKEN=$(curl -s -u "$CLIENT_ID:$CLIENT_SECRET" -d grant_type=client_credentials \
        $HOST/obx/v1/oauth/token | jq -r .access_token)
```

OAuth2 client credentials. A token lives about an hour; when a call answers `401 invalid_token`, get a new one. `401 access_revoked` means the brand ended your access: stop syncing and tell a person.

## 4. Pagination: every list has more pages

**Every list in OBX is paginated with an opaque cursor.** One call gives you one page, never everything. Keep asking with the cursor the page gave you until the page says it is the last one. Do not stop because a page has fewer items than `limit`; a node may always return fewer.

| Endpoint | Page size (`limit`) | Next page | Last page when |
|---|---|---|---|
| `GET /obx/v1/products` | 1–100, default 25 | `cursor=<next_cursor>` | `next_cursor` is `null` |
| `GET /obx/v1/changes` | 1–500, default 100 | `cursor=<next_cursor>` | `has_more` is `false` (`next_cursor` is **always** there: keep it for the next run) |

`GET /obx/v1/brands` is not paginated (a portal has few brands). The node's maximums are in the discovery document (`limits.products_page_max`, `limits.changes_page_max`). Treat the cursor as opaque: do not parse it, build it or change the other query parameters (`brand_id`, `updated_since`) between pages. A cursor the node cannot use is a `400` (`cursor_invalid`, or `invalid_request`); a `/changes` cursor that is too old is `410 cursor_expired` (start again without one). The rules: [protocol.md §2.1](protocol.md#pagination).

**All products, curl and jq:**

```sh
# All products, page by page: follow next_cursor until it is null.
cursor=""
: > products.ndjson
while :; do
  page=$(curl -sf -G -H "Authorization: Bearer $TOKEN" "$HOST/obx/v1/products" \
         --data-urlencode "limit=100" ${cursor:+--data-urlencode "cursor=$cursor"}) || exit 1
  echo "$page" | jq -c '.items[]' >> products.ndjson
  cursor=$(echo "$page" | jq -r '.next_cursor // empty')
  [ -z "$cursor" ] && break
done
wc -l < products.ndjson
```

**JavaScript** (Node 18+ or any runtime with `fetch`):

```js
const HOST = process.env.HOST, TOKEN = process.env.TOKEN;

async function* allProducts(params = {}) {
  let cursor = null;
  do {
    const q = new URLSearchParams({ limit: "100", ...params });
    if (cursor) q.set("cursor", cursor);
    const res = await fetch(`${HOST}/obx/v1/products?${q}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.json()).obx_error}`);
    const page = await res.json();
    yield* page.items;
    cursor = page.next_cursor; // null on the last page
  } while (cursor);
}

let n = 0;
for await (const p of allProducts()) n++, console.log(p.style_number);
console.log(`${n} products`);
```

**Go** (standard library only):

```go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
)

type productsPage struct {
	Items      []json.RawMessage `json:"items"`
	NextCursor *string           `json:"next_cursor"` // null on the last page
}

func main() {
	host, token := os.Getenv("HOST"), os.Getenv("TOKEN")
	cursor, n := "", 0
	for {
		q := url.Values{"limit": {"100"}}
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		req, _ := http.NewRequest("GET", host+"/obx/v1/products?"+q.Encode(), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			log.Fatal(err)
		}
		if res.StatusCode != http.StatusOK {
			log.Fatalf("GET /products: %s", res.Status)
		}
		var page productsPage
		err = json.NewDecoder(res.Body).Decode(&page)
		res.Body.Close()
		if err != nil {
			log.Fatal(err)
		}
		n += len(page.Items) // handle page.Items here
		if page.NextCursor == nil {
			break
		}
		cursor = *page.NextCursor
	}
	fmt.Println(n, "products")
}
```

**The change feed to the end.** The same loop, but stop on `has_more: false` and save `next_cursor` after every page (a crash then replays at most one page, and the feed is at-least-once anyway):

```sh
cursor=$(cat obx.cursor 2>/dev/null)
while :; do
  page=$(curl -sf -G -H "Authorization: Bearer $TOKEN" "$HOST/obx/v1/changes" \
         --data-urlencode "limit=500" ${cursor:+--data-urlencode "cursor=$cursor"}) || exit 1
  echo "$page" | jq -c '.changes[]' >> changes.ndjson     # apply them here
  cursor=$(echo "$page" | jq -r .next_cursor)              # always present
  echo "$cursor" > obx.cursor                              # save after every page
  [ "$(echo "$page" | jq -r .has_more)" = true ] || break
done
```

```js
async function syncChanges(cursor, apply) {
  for (;;) {
    const q = new URLSearchParams({ limit: "500" });
    if (cursor) q.set("cursor", cursor);
    const res = await fetch(`${HOST}/obx/v1/changes?${q}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status === 410) { cursor = null; continue; } // cursor_expired: start a new snapshot
    if (!res.ok) throw new Error(`${res.status} ${(await res.json()).obx_error}`);
    const page = await res.json();
    for (const change of page.changes) await apply(change, page.phase);
    cursor = page.next_cursor; // always present: persist it here
    if (!page.has_more) return cursor;
  }
}
```

In Go, the [obx-go](https://github.com/openbrandexchange/obx-go) SDK does both loops for you: `EachProduct` follows `next_cursor`, `Sync` reads the feed (snapshot, resyncs, expired cursors) and saves the cursor after every page:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/openbrandexchange/obx-go/client"
	"github.com/openbrandexchange/obx-go/obx"
)

func main() {
	ctx := context.Background()
	c, err := client.New(client.Config{
		BaseURL:      os.Getenv("HOST"),
		ClientID:     os.Getenv("CLIENT_ID"),
		ClientSecret: os.Getenv("CLIENT_SECRET"),
	})
	if err != nil {
		log.Fatal(err)
	}

	// Browsing: every product of the query, all pages.
	n := 0
	err = c.EachProduct(ctx, client.ProductsQuery{Limit: 100}, func(p *obx.ProductDetail) error {
		n++
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(n, "products")

	// Synchronising: snapshot, then live; the cursor is saved after every page.
	counts := map[string]int{}
	err = c.Sync(ctx, client.FileCursorStore("obx.cursor"), client.SyncOptions{},
		func(ctx context.Context, ev client.Event) error {
			if ev.Kind == client.EventChange {
				counts[ev.Change.Type]++ // apply ev.Change here
			}
			return nil
		})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(counts)
}
```

Against the mock portal (`obx-conformance mock`, 11 products) every version prints `11 products`, also with `limit=3` (4 pages); the feed loop reads 94 entries (2 brands, 11 products, 46 variants, 35 assets) and a second run reads none.

**Browsing or synchronising?** `/products` is for browsing and targeted reads (a page for a screen, `ids=` for a list you already have). To keep a copy of the catalog, use the change feed: it gives you everything once and then only what changed, including deletes, which `/products` cannot tell you.

## 5. The change feed: everything, then only what changed

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$HOST/obx/v1/changes?limit=500" | jq '{phase, has_more, next_cursor, n: (.changes | length)}'
```

Without a cursor you get a **snapshot**: one `upsert` for every brand, product, variant and asset you may see, each with its current `data`. Keep calling with `cursor=<next_cursor>`. The first page with `phase: "live"` means the snapshot is complete; from then on you only get changes. When `has_more` is `false`, store `next_cursor` and ask again later (once a minute is plenty, or when a webhook says so: [section 8](#8-get-notified-instead-of-polling)). The complete loop is in [section 4](#4-pagination-every-list-has-more-pages).

Apply each entry by `type` and `op`:

| Entry | Do |
|---|---|
| `upsert` | create or replace your copy of the object with `data` (it is always the current version) |
| `delete` | remove it (ignore ids you do not know) |
| `grant` with `resync: true` | what you may see changed: start again without a cursor, then delete what the new snapshot did not contain |

Entries can repeat and a variant can arrive before its product; key everything on `id`. Details: [protocol.md §6](protocol.md#6-the-change-feed).

## 6. Products, variants and images

A product in the feed is the style; its sizes (`variant`) and images (`asset`) are separate entries. To read one product with everything in it:

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$HOST/obx/v1/products/<id>" | jq '{style_number, item_type, item_subtype, materials, features, variants: [.variants[] | {gtin, size, measurements}], assets: [.assets[] | {position, role, view}]}'
```

What you get ([protocol.md §5](protocol.md#5-data-model)):

- **product**: style number, names and descriptions per language, item type and subtype, composition per part (part, material and qualifier as a code with a name per language), care codes with category, symbol and name, country of origin, footwear materials, certifications and typed features (wheels, lock, closure, ...);
- **variant**: colour (with a colour family for filters), size, the EAN as `gtin` (14 digits; `gtin_original` is what the brand typed) and measurements in cm, kg and litres;
- **asset**: a final image with its colour, order (`position`), role, view, usage rights and AI provenance.

Which of these the law requires you to show is in [protocol.md §5.9.7](protocol.md#legal-basis). Respect `rights.embargo_until` (do not show the image publicly before then) and pass `provenance` on to your own channels.

Already have EANs? Look them up directly (up to 2000 per call):

```sh
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"gtins": ["2000100801017", "2000100101025"]}' "$HOST/obx/v1/products:by-gtin"
```

## 7. Renditions: the image files

Every asset has `renditions`: `web` (JPEG, at most 2000 px), `square` (the web image on a white square), `thumb` (at most 600 px) and, if the brand allows it for you, `original` (the exact uploaded file).

```sh
curl -s -H "Authorization: Bearer $TOKEN" -o KO-1008_BLK_1.jpg "$HOST/obx/v1/assets/<asset id>/renditions/web"
```

Or use the rendition's `url`: when `url_expires_at` is set it works without a token until then; read the asset again (`GET /obx/v1/assets/{id}`) for a fresh one. Every rendition has a `sha256`: download only when it changed, and check the bytes. Details: [protocol.md §5.5](protocol.md#55-renditions).

## 8. Get notified instead of polling

If the portal has the `webhooks` capability, let it tell you when there is something new instead of asking every minute. Subscribe once with your token:

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"url": "https://store.example/hooks/obx", "events": ["changes.available", "grant.updated"]}' \
     "$HOST/obx/v1/webhooks"        # → 201 with the secret (whsec_…), shown only now
```

When the feed has new entries for you, the portal sends a signed `POST` to your URL ([WebhookEvent](../schemas/WebhookEvent.json)):

```json
{
  "id": "evt_1",
  "type": "changes.available",
  "created_at": "2026-09-28T10:00:00Z",
  "data": {
    "latest_seq": 1044
  }
}
```

Your receiver does three things:

1. **Verify** `OBX-Webhook-Signature: v1=<hex>`: HMAC-SHA256 with the secret over `<OBX-Webhook-Timestamp>.<raw body>`, compared in constant time; reject timestamps more than 300 s off. Test vector: [`webhook-signature-vector.json`](../fixtures/examples/webhook-signature-vector.json).
2. **Answer 2xx within 10 s** and de-duplicate on the event `id` (deliveries are retried).
3. **Pull `/changes`** from your stored cursor until `has_more` is `false` (the loop in [section 4](#4-pagination-every-list-has-more-pages)). The webhook is only a wake-up call: it carries no product data, and the feed stays the source of truth.

Keep a slow poll as a safety net (for example hourly) in case a delivery is lost. `grant.updated` means what you may see changed; `export.completed` tells you a bulk export is ready. Details: [protocol.md §2.2](protocol.md#notifications) and [§9](protocol.md#9-webhooks-capability-webhooks).

## Done. Optional extras

| When you want | Use | Capability |
|---|---|---|
| a nudge instead of polling | webhooks, `changes.available` ([section 8](#8-get-notified-instead-of-polling)) | `webhooks` |
| one big download of everything | bulk exports: manifest + zip parts ([§8](protocol.md#8-bulk-exports-capability-exports)) | `exports` |
| to tell the brand where its images are used | usage events ([§10](protocol.md#10-usage-events-capability-usage)) | `usage` |

Check `capabilities` in the discovery document first; a portal without one answers `501 not_implemented`. To test your code without a real brand, run the mock portal from [obx-go](https://github.com/openbrandexchange/obx-go): `obx-conformance mock --addr :8080` starts an in-memory portal that speaks the whole protocol.
