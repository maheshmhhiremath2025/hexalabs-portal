# Makefile - convenience targets for the COBOL samples.
# Usage:
#   make           # build all samples
#   make run-hello # compile & run hello
#   make run-payroll
#   make run-inventory
#   make debug-payroll  # launch under gdb

COBC  := cobc
CFLAGS := -x -g -debug -Wall

all: hello payroll inventory

hello: hello.cob
	$(COBC) $(CFLAGS) -o $@ $<

payroll: payroll.cob
	$(COBC) $(CFLAGS) -o $@ $<

inventory: inventory-isam.cob
	$(COBC) $(CFLAGS) -o $@ $<

run-hello: hello
	./hello

run-payroll: payroll
	./payroll

run-inventory: inventory
	./inventory

debug-payroll: payroll
	gdb ./payroll

clean:
	rm -f hello payroll inventory STOCK.IDX *.o

.PHONY: all run-hello run-payroll run-inventory debug-payroll clean
