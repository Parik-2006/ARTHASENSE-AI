# Third-party notices

ArthaSense AI is an original project. It uses ideas and, where listed below, adapted code from
the following MIT-licensed projects. Their copyright and permission notices are reproduced in
full, as the MIT licence requires.

## Where third-party material is used

| Upstream | Commit inspected | What ArthaSense takes from it | Files |
|---|---|---|---|
| [adhishthite/india-economic-dashboard](https://github.com/adhishthite/india-economic-dashboard) | `ff66e7c` | Reference for the MoSPI dataset/indicator filter codes and the Recharts patterns (RBI target band). **No UI, layout, styling or branding is copied.** | None yet. Files that adapt its code will carry a header pointing here (expected from M3/M9). |
| [nso-india/esankhyiki-mcp](https://github.com/nso-india/esankhyiki-mcp) | `5317aa0` | Paths of the public MoSPI REST endpoints (`api.mospi.gov.in`) and their query-parameter names | `pipeline/sources/mospi.py` |

Header used in adapted files:

```
Adapted from <upstream> (MIT). See THIRD_PARTY_NOTICES.md.
```

The upstream repositories themselves are not modified by this project.

---

## india-economic-dashboard

```
MIT License

Copyright (c) 2025 Adhish Thite

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## esankhyiki-mcp

```
MIT License

Copyright (c) 2026 Ministry of Statistics and Programme Implementation (MOSPI)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts

Newsreader and IBM Plex (Sans, Mono) are licensed under the SIL Open Font License 1.1 and are
self-hosted through the `@fontsource` npm packages, which include their licence files.

## Data

Economic data comes from official publishers (MoSPI/NSO, RBI, Office of the Economic Adviser,
Labour Bureau, World Bank). It is not covered by this repository's licence. Each source's terms
are recorded in `docs/m1-data-verification.md` and, from M2, in the `sources` table.
