# swimming-pool-hk-scraper

To install dependencies:

```bash
bun install
```

To run the admission scraper:

```bash
bun run admission
```

To run the basic scraper:

```bash
bun run basic
```

To build and run the single binary:

```bash
bun run build
./swimming-pool-hk-scraper admission
./swimming-pool-hk-scraper basic
```

Admission data is saved under `data/admission`, including the latest snapshot
and daily history. Basic pool data is overwritten at `data/basic/latest.json`.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
