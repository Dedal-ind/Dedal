# College seed migration

## Why this exists

Profile completion originally let users type their college as free text, which
produced typos, misspellings and inconsistent abbreviations. This migration
seeds a curated list of ~80 real Bangalore colleges (engineering, medical,
arts/commerce, law, business) into the `colleges` collection with
`isVerified: true`, so the `/profile-completion` college field can be a
searchable dropdown backed by clean data.

Data was sourced from Wikipedia's Bengaluru college category pages and the VTU
Bangalore-region college code list (which supplies the verified USN prefixes
such as `1RV` for RVCE and `1BM` for BMSCE). AISHE codes were not verifiable
from those sources and are left absent.

## How to run

```
npm run migrate:colleges
```

The script is **insert-only and idempotent**:

- A college that already exists (matched by `aisheCode` when present, or exact
  `collegeName`/`commonName`, case-insensitive) is skipped.
- Existing documents — including user self-registered colleges and existing
  users' free-text college values — are never modified or deleted.
- Safe to run any number of times; a re-run reports everything as skipped.

It prints: `Added X colleges. Skipped Y (already existed). Total N.`

### Production

Same command on the EC2 server after pulling the latest code:

```
ssh <ec2-host>
cd <backend-directory>
git pull
npm run migrate:colleges
```

## How to add more cities (Mumbai, Delhi, Chennai, ...)

1. Create `src/helpers/college-seed-data/<city>-colleges.js` with the same
   shape as `bangalore-colleges.js`: an exported array of
   `{ collegeName, commonName, city, state, aisheCode?, usnPrefix, collegeType }`.
   Omit `aisheCode` entirely (do not set it to `null`) when unknown — the
   collection has a sparse unique index on it.
2. Import it in `src/helpers/migrate-bangalore-colleges.js` and add it to the
   `CITY_SEED_LISTS` array.
3. Run `npm run migrate:colleges` again — existing cities are skipped, the new
   city's colleges are inserted.

The public endpoint `GET /api/v1/colleges` accepts `?city=<name>`
(case-insensitive exact match) so the frontend can scope the dropdown per city.
