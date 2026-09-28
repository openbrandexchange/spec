# Governance

Open Brand Exchange is an open standard for exchanging product content between brands and retailers. It is free to read, implement and build on, and it is meant to stay that way no matter who implements it commercially. This page says who decides what today, where the project is heading, and how anyone can take part.

## Publisher today, foundation tomorrow

- **Publisher.** Open Brand Exchange is **an initiative of Richard Lindhout**, who publishes the specification, holds the copyright in what he wrote, owns the domain `openbrandexchange.com` and administers the `openbrandexchange` GitHub organisation.
- **Foundation.** Everything will be transferred to the **Open Brand Exchange Foundation (in formation)**, a Dutch *stichting* (a foundation under Dutch law: no members, no shareholders, no profit distribution). Until the deed has been signed, the name is always written with "(in formation)" (translations in the [glossary](glossary.md#the-project-and-its-publisher)). The name is never translated.
- **What the foundation will own:** the copyright in the specification, schemas, fixtures, SDK, admin UI, reference portals and website that the publisher holds; the name and logo "Open Brand Exchange" (trademark application at the Benelux Office for Intellectual Property); the domain; the GitHub organisation.
- **The draft statutes** are in [`governance/statutes-sketch.md`](../governance/statutes-sketch.md) (English) and [`governance/statuten-schets.md`](../governance/statuten-schets.md) (Dutch, for the notary). They are a sketch for discussion with a notary, not legal advice and not a deed.

In short, the statutes will fix five things:

1. **Purpose.** Develop, maintain and promote an open standard for product-content exchange between brands and retailers, and keep it freely available to everyone.
2. **Board.** The founder chairs it and appoints the other board members. The other board members can only remove him together, unanimously. Dutch law always lets a court remove a board member (art. 2:298 of the Dutch Civil Code, BW).
3. **A double lock on what matters most.** Changing the statutes, transferring or licensing the trademark, domain or copyrights, changing the licences of the specification or the code, merging or dissolving: all of these need a unanimous board **and** the approval of a separate **advisory board** of independent members. Later, seats on the advisory board are added for brands and for implementers.
4. **Asset lock.** The foundation may only use its intellectual property for its purpose, and may only transfer it to a non-profit with the same purpose. That also applies when it is dissolved.
5. **No profit, no conflicts.** No profit distribution (art. 2:285 BW); reasonable pay for work done is allowed. A board member linked to a company that implements OBX commercially (Photopilot, the founder's company, is the first) does not vote on matters that affect that company (art. 2:291 BW).

## Neutrality

- Nothing in the specification may require a particular vendor, hosted service or proprietary component. Any organisation may implement it, host it for others, or build a competing product on it.
- Conformance is decided by the public test suite ([conformance.md](conformance.md)), not by who wrote the implementation. The founder's company gets no special treatment in conformance, in the directory or in the use of the name.
- The public directory at openbrandexchange.com lists every brand that asks and passes the protocol profile ([directory.md](directory.md)).

## Who decides changes to the specification

- **Today** the maintainers of the `spec` repository decide, led by the publisher.
- **After the foundation is set up**, the board appoints the maintainers and sets the process below; the board does not overrule a technical decision the maintainers took by this process, except under the double lock (for example a licence change).
- **Once there are three independent implementations** (from organisations that do not share ownership) that pass the protocol profile, the foundation adds a technical steering group with one seat per such implementer and at least one brand and one retailer representative. It decides by consensus, falling back to a two-thirds majority.

### Process

- Proposals are pull requests to the `spec` repository with a short rationale ("RFC" label for anything beyond wording).
- Every normative change updates the OpenAPI files, schemas, prose, fixtures and changelog together, and keeps `npm run check` green.
- Substantive RFCs stay open for comments for at least 14 days before a decision. Decisions and their reasons are written in the pull request.
- Versions follow [versioning.md](versioning.md). A maintainer tags a release after the changelog is complete; nothing is released by merging alone.

## Contributions

Contributions are accepted under the [Developer Certificate of Origin](https://developercertificate.org/) (`Signed-off-by:` in every commit, see [CONTRIBUTING.md](../CONTRIBUTING.md)); there is no contributor licence agreement. Contributors keep the copyright in their contributions and license them under the repository's licence. The foundation therefore owns only what the publisher (and later the foundation itself) wrote, and relies on the licences for everything else; that is enough, because the licences are irrevocable. Everyone taking part follows the [Code of Conduct](../CODE_OF_CONDUCT.md).

## Licences

| What | Licence |
|---|---|
| Specification text, OpenAPI files, JSON Schemas, fixtures | [CC-BY-4.0](../LICENSE) |
| SDK, `obx` CLI, conformance suite, admin UI | Apache-2.0 |
| Reference portals (node-go, node-php, node-ts) | AGPL-3.0 |
| Website | content CC-BY-4.0, code MIT |

A change to any of these licences falls under the double lock. Licences already granted cannot be taken back.

## Patents

Richard Lindhout, and the companies he controls (including Photopilot), commit not to assert any patent they hold or control against an implementation of this specification, to the extent needed to implement it, in the spirit of the Open Web Foundation Final Specification Agreement. The foundation will take over this commitment. Contributors are asked to make the same commitment for their contributions.

## The name and conformance claims

- "Open Brand Exchange", "OBX" and the logo identify this standard. Until a trademark policy is published, anyone may use the name to say truthfully that a product implements or works with OBX.
- "**OBX-conformant**" may be used by an implementation that passes the corresponding conformance profile of the claimed version; the claim names the profile(s) and version, for example "OBX 0.1 protocol + ingest". The badge "Works with Open Brand Exchange" is for implementations that pass at least the protocol profile.
- Once registered, the trademark is licensed to **every implementer on the same terms**, free of charge, with conformance as the only technical condition. Nobody, the founder's company included, gets an exclusive or better licence.
- Nobody may present an implementation as *the* official Open Brand Exchange product, or suggest endorsement by the foundation, without its written consent.

## Contact

- General questions, directory removals, trademark questions: **hello@openbrandexchange.com**
- Vulnerabilities: **security@openbrandexchange.com** (see [SECURITY.md](../SECURITY.md))
