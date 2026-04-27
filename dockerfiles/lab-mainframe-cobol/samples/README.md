# GetLabs — COBOL Dev Workstation

Browser-based VS Code with GnuCOBOL, gdb, and COBOL language extensions pre-installed.
Used by the **AWS Mainframe Modernization** lab to cover Day 3 "develop / modify / debug
COBOL" objectives without a Micro Focus license.

## Quick start

Open the integrated terminal (`` Ctrl+` ``) and run:

```bash
cd /home/coder/workspace/cobol-samples
make              # compiles hello + payroll + inventory
./hello           # "Hello from GnuCOBOL on GetLabs"
./payroll         # weekly payroll report (in-memory demo data)
./inventory       # creates STOCK.IDX, then updates SKU00002
```

## Samples

| File | Teaches |
|---|---|
| `hello.cob` | Program structure, DISPLAY, STOP RUN |
| `payroll.cob` | OCCURS tables, PERFORM VARYING, IF/ELSE, COMPUTE, edited picture clauses |
| `inventory-isam.cob` | Indexed (VSAM-like) files, RANDOM access, WRITE/READ/REWRITE, FILE STATUS |

`EMPLOYEES.DAT` is provided as example raw data for the "extend payroll to read from a
flat file" exercise — a natural follow-on task for students.

## Debugging

Use the `OlegKunitsyn.gnucobol-debug` extension (pre-installed):

1. Open any `.cob` file
2. Press **F5** → select "GnuCOBOL debug"
3. Set breakpoints, step through, inspect variables

Or use gdb directly:

```bash
make debug-payroll
(gdb) break MAIN-PARA
(gdb) run
```

## Adding your own programs

Drop `.cob` files anywhere under `/home/coder/workspace/`.
The Makefile assumes `cobc -x -g -debug -Wall` — same pattern for your code.
