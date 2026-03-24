# Monaco FM Source Notes

## Official URLs Checked

- `https://www.mmd.mc/en/fm-46`
- `https://www.mmd.mc/en/clients`

## Source Assessment

- `mmd.mc` is the official Monaco Media Diffusion site.
- The FM page states that MMD offers `21 radio stations across 30 frequencies`.
- The clients page lists partner stations and whether they are carried on `FM`, `DAB+`, or both.

## Blocker

- The official public pages do not expose the FM frequency matrix in machine-readable or even reliable text form.
- The FM page provides station buttons, streams, and a coverage image, but not a structured mapping of station to frequency or transmission site.
- The clients page confirms carriage but still omits the actual FM frequencies.
- Building an importer would require OCR or manual interpretation of non-tabular public content, which does not meet the clean and reproducible bar.

## Conclusion

No importer was implemented for Monaco in this change. The official blocker is that MMD publishes the station roster and coverage marketing, but not the underlying FM frequency assignments in a reusable format.
