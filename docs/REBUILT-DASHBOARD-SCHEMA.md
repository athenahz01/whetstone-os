# Rebuilt !Dashboard - header schema

Captured 2026-09-02 by the auditor, from the live sheet
`1WwRoTJfW9b4eKfpshXMX1AKbYOv31Fru9yBoY1BTtMM` ("!Dashboard rebuild"), authored
by Athena on 2026-08-28 and cross-checked by her against the CRM Action Sheet
v1.0.

This exists because the 7.5a retarget was blocked on it. The executor refused to
invent headers from the three column names a verdict mentioned in passing, which
was right. These are read off the sheet, not inferred.

**One header row.** Row 1 is headers, row 2 onward is data. The old sheet's
merged banner row, blank spacer columns and orphan labels such as
`Region / Column 42` are gone.

## Tabs

`Read Me`, `Overview`, `Action Queue`, `UG Sales`, `G Sales`, `Affiliate`,
`Data Issues`, `Lists`. Only the three data tabs below are import sources.
`Overview` and `Action Queue` are live formulas over `UG Sales` and must never
be imported - they are derived, and importing them would duplicate the leads.

## UG Sales - 52 columns, 69 rows

```
ID | S First | S Last | S Phone | S Email | HS Year | School | Status | Region
P1 First | P1 Last | P1 Relation | P1 Phone | P1 Email | Contact Method
P2 First | P2 Last | P2 Relation | P2 Phone | P2 Email
Outcome | Deal Size | Lead Date | Referrer Source | Referrer | Pain / Need
M1 Date | M1 Med | M1 Client | M1 Closer | M1 Notes
M2 Date | M2 Med | M2 Client | M2 Closer | M2 Notes
M3 Date | M3 Med | M3 Client | M3 Closer | M3 Notes
Next Action | Responsible | Due Date (as entered) | Notes
Last Touch | Days Quiet | Chase After | Chase Flag | Contactable | Data Flags | _key
```

**Renames from the old sheet**, which the column map must handle:

| old | rebuilt |
|---|---|
| `S Contact S Last` | `S Last` |
| `P Contact P1 Last` | `P1 Last` |
| `1M Date` / `1M Pain` / `CC 1M Med` | `M1 Date` / `Pain / Need` / `M1 Med` |
| `2M Date`, `3M Date` and their `CC nM Med` | `M2 *`, `M3 *` |
| `Due Date` | `Due Date (as entered)` |
| `Region Column 42` | gone, folded into `Region` |

**Nine columns that did not exist before:** `School`, `Contact Method`,
`Pain / Need` (renamed and kept), `Last Touch`, `Days Quiet`, `Chase After`,
`Chase Flag`, `Contactable`, `Data Flags`, `_key`, plus `Contract Start`,
`Contract End` and `Renewal Review` where present.

**Six of those are formulas, not data: `Last Touch`, `Days Quiet`,
`Chase After`, `Chase Flag`, `Contactable`, `Data Flags`.** They must be
**imported as derived, or not imported at all.** Writing them into `crm_leads`
as if they were typed values would store a snapshot of a computation and let it
drift from the touch history the database keeps itself. `Days Quiet` and
`Chase Flag` in particular are the spreadsheet's own silence clock, and
`S5.silence-clock` computes the same thing from `crm_touches`.

## G Sales - 49 columns, 32 rows

```
ID | S First | S Last | Target | Type | Field | S Phone | S Email
P1 First | P1 Last | P1 Relation | P1 Phone | P1 Email
Status | Admission Status | Materials | SAT / GRE | Academic | Tutoring Notes
Capstone | Essays | Lead Date | Referrer Source | Referrer | Pain / Need
M1 Date | M1 Med | M1 Client | M1 Closer | M1 Notes
M2 Date | M2 Med | M2 Client | M2 Closer | M2 Notes
M3 Date | M3 Med | M3 Client | M3 Closer | M3 Notes
Next Action | Responsible | Due Date (as entered) | Notes
Last Touch | Days Quiet | Chase After | Chase Flag | Data Flags
```

Note `SAT / GRE` rather than the old `SAT`, and that the academic columns which
used to live only in `Copy of !Dashboard` are here on the canonical sheet. **The
fork is resolved at the source**, which is the point of retargeting.

## Affiliate - 10 columns, 21 rows

```
First | Last | Full name | Type | Leads referred | Won | Lost / NQ | Still live | Last lead date | Notes
```

Restructured, not just renamed: `Leads referred`, `Won`, `Lost / NQ`,
`Still live` and `Last lead date` are new. No `ID` column - the key is
`Full name`, so `crmIdentity` needs a different rule for this tab.

## Fill counts, UG Sales, 2026-09-02

The reason the importer alone does not fix anything.

```
ID 69   Referrer Source 52   S First 48   Contactable 48   Status 45
Lead Date 44   HS Year 44   Last Touch 44   Days Quiet 44   Region 42
M1 Med/Client/Closer 34 each   S Phone 27   P1 Relation 27   Pain / Need 24
Chase After 19   Chase Flag 19   School 18   _key 18   S Email 17   P1 Email 17
Notes 12   M1 Date 8   M2 Date 7   Due Date (as entered) 7   M3 Date 4
Deal Size 3   Next Action 5   Responsible 5
Contact Method 0   Outcome 0   P2 Last/Relation/Phone/Email 0
```

**`Last Touch` is filled on 44 rows and `Lead Date` on 44 rows.** The meeting
dates it should prefer are filled on 8, 7 and 4. So `Last Touch` is the lead date
for almost every row, and `Days Quiet` is measuring age since intake rather than
silence since contact. The formulas are correct and their inputs are empty.

**`Chase Flag` is set on 19 rows.** `S5.silence-clock` independently produced 19
live leads from the same data, which is a useful agreement between the two
implementations.

**`Contact Method` is 0** and the Action Sheet asks for it at lead creation.
**`Outcome` is still 0 of 69**, unchanged from the original audit.
