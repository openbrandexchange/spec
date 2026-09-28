# Directories: making brands findable

A **directory** is a public list of OBX nodes so that retailers (and their software) can find a brand and request access. A directory contains **discovery URLs and a little search metadata only**, never product data. Anyone may run a directory; a brand may be listed in several.

## directory.json

Schema: [Directory](../schemas/Directory.json) / [DirectoryEntry](../schemas/DirectoryEntry.json). Example: [`fixtures/examples/Directory.example.json`](../fixtures/examples/Directory.example.json).

```json
{
  "version": 1,
  "updated_at": "2026-09-28T10:00:00Z",
  "entries": [
    {
      "id": "kestrel-outfitters",
      "name": "Kestrel Outfitters",
      "discovery_url": "https://brands.kestrel.example/.well-known/obx",
      "website": "https://kestrel.example",
      "brands": ["Kestrel", "Kestrel Trail"],
      "countries": ["NL", "BE", "DE"],
      "categories": ["fashion", "outdoor"],
      "languages": ["nl", "en"],
      "listed_at": "2026-09-28"
    }
  ]
}
```

- `id`: unique slug in that directory.
- `discovery_url`: MUST return a valid discovery document; everything else (logo, contact, capabilities, whether access requests are open) is read live from there, so a listing never goes stale.
- `categories` (recommended): `fashion`, `shoes`, `accessories`, `sports`, `outdoor`, `kids`, `lingerie`, `home`.

Consumers SHOULD fetch the discovery document before showing an entry and hide entries whose node does not answer. Directory operators SHOULD re-check listings weekly and remove entries that fail for 30 days.

## The public directory at openbrandexchange.com

The website repository keeps `data/directory.json`. To be listed:

1. Make sure `https://<your-host>/.well-known/obx` answers and your node passes the protocol conformance profile.
2. Open a pull request against the website repository adding one entry (keep entries sorted by `id`).
3. The CI of the website validates the file against the schema and fetches your discovery URL.
4. Only the brand itself (or its hosting provider on its behalf) may request a listing. Retailers, scrapers or aggregators cannot list a brand.

To be removed, open a pull request removing the entry or contact the maintainers.
