# Iceland FM source notes

Verified from this environment on 2026-03-24.

## Outcome

Blocked for a national FM importer.

I did not find a clean official source that exposes all of these together for current Icelandic FM broadcasting:

- station or programme name
- licensee/operator
- tuneable FM frequency
- transmitter site or city

The official sources that are accessible split the information across regulators and documents, but none provides a current nationwide FM transmitter registry that can be turned into a reliable tuneable catalog.

## Official sources checked

### 1. Fjölmiðlanefnd media registry

- List page: <https://fjolmidlanefnd.is/fjolmidlar/>
- Example station detail: <https://fjolmidlanefnd.is/fjolmidlar/ras-1/>
- Example station detail: <https://fjolmidlanefnd.is/fjolmidlar/utvarp-saga/>

What it provides:

- station/programme name
- media company / licensee
- responsible editor / contact
- service area such as `Landið allt` or `Ísland`
- permit/license status and expiry

Why it is insufficient:

- no FM frequency table
- no transmitter site list
- no coordinates
- no per-area frequency splits for nationwide services

This is useful for ownership and licensing metadata, but not for a tuneable FM catalog.

### 2. Fjarskiptastofa consultation on FM/DAB allocation

- <https://www.fjarskiptastofa.is/library/?itemid=91aff31c-5fcc-11e7-9420-005056bc2afe>

What it provides:

- consultation background on FM and DAB
- some requested/additional FM frequencies on the capital area
- named stations and proposed/temporary coverage discussions

Why it is insufficient:

- limited to a consultation around selected frequencies, not a national registry
- not a comprehensive list of all current FM assignments
- not a reproducible source for station-by-site nationwide coverage

### 3. Fjarskiptastofa individual frequency decision example

- <https://www.fjarskiptastofa.is/library/Skrar/akv.-og-urskurdir/akvardanir-PFS/Akv_PFS_nr.15_2016_Utvarp_Saga.pdf>

What it provides:

- a concrete frequency case for one broadcaster
- example frequencies such as `99,4 MHz` and `102,1 MHz`
- one proposed site reference (`Vatnsendi`) for a specific dispute

Why it is insufficient:

- single-case decision only
- not a full country list
- cannot be generalized into a current FM database

### 4. Fjarskiptastofa historical market analysis

- <https://www.fjarskiptastofa.is/library/?itemid=78791931-6637-11e3-93f5-005056bc0bdb>

Relevant part:

- table `Langtímaleyfi fyrir hljóðvarp`

What it provides:

- historical long-term radio licenses
- licensee, call sign, validity dates, broad service area

Why it is insufficient:

- historical, not current
- the document itself notes that not all licensed stations may actually be broadcasting and that some call signs had changed
- no current transmitter-by-transmitter FM coverage data
- no site/city rows for tuning

### 5. Fjarskiptastofa annual report

- <https://www.fjarskiptastofa.is/library?itemid=564a2fcc-ba8e-44f6-8a26-eea42a23a7c7&type=pdf>

What it provides:

- summary counts such as `Hljóðvarps- og sjónvarpsstöðvar`
- counts of temporary permits and short-term radio

Why it is insufficient:

- aggregate counts only
- no station-frequency-site registry

## Exact blocker

For `hackrf-webui`, a useful FM source needs rows that can be tuned directly, which means at minimum:

- frequency in MHz
- station/programme name
- place/site or coordinates

The official Icelandic sources accessible here do not expose a current nationwide dataset at that level.

The media regulator has station/licensee metadata but no frequencies.
The telecom regulator has scattered decisions and consultations with some frequencies, but not a comprehensive current registry of FM assignments by transmitter site.

Because many Icelandic stations are multi-site or nationwide, service-area labels such as `Landið allt` or `Ísland` are not enough to build a tuneable catalog.

## Implementation decision

No importer was implemented.

If Fjarskiptastofa later publishes a current public register with at least frequency plus station plus site/city, that should be the primary source. Fjölmiðlanefnd could then be used only as optional enrichment for licensee metadata.
