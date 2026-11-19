# SafeWatch

A child-safety awareness web app. It shows **public sex-offender registry records** near the
places a family cares about, alerts when new records appear in those areas, and gets concerns to
the authorities who can act on them.

## Features

- **Map search**: search by address or ZIP, or use your location, and see registry records within 0.5–5 miles.
- **Watch zones**: save Home, School, Park and so on. Each check flags records that are *new* since the last check, with optional browser notifications.
- **Report**: one tap to 911, the NCMEC CyberTipline, FBI tips and Childhelp, plus a guide to preserving evidence.
- **Incident notes**: private, on-device notes you can export as a text file to give to police.
- **Warning signs**: grooming red flags, in person and online, and what to tell kids.

## Data

SafeWatch doesn't collect, guess at or crowdsource information about anyone.

- **Demo mode** (the default) generates obviously fictional records from map coordinates, so the app can be tried anywhere.
- **Real data**: load a CSV export from your state registry or a licensed provider (Data tab). The format is in `sample-format.csv`. Check your state's terms first, because many restrict republishing registry data.
- For an official lookup, use [NSOPW.gov](https://www.nsopw.gov/).

All data, zones and notes stay in the browser's localStorage. There is no server.

## Deliberately not included

- Live location tracking of individuals
- User-submitted "suspects" or accusations
- Sharing or publishing records

These features lead to misidentification, harassment and violence, and they can compromise real
investigations. Concerns go to law enforcement and NCMEC instead.

## Run it

It's a static site. Open `index.html`, or serve the folder:

```sh
cd safewatch && python3 -m http.server 8000
```

To deploy, enable GitHub Pages on the repo; the app will be at `/safewatch/`.
