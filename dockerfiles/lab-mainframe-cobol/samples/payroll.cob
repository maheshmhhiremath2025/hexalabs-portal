      ******************************************************************
      * PAYROLL.COB - In-memory payroll demo.
      *   Keeps the employee data in WORKING-STORAGE (OCCURS table) so
      *   students see PERFORM VARYING, IF/ELSE, COMPUTE and classic
      *   batch-report formatting without having to also debug fixed-
      *   width file parsing on day 1.
      *
      *   For the file-I/O variant, see the EMPLOYEES.DAT sample and
      *   extend this program to READ from it — that's a good follow-on.
      *
      * Compile: cobc -x -o payroll payroll.cob
      * Run:     ./payroll
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYROLL.

       DATA DIVISION.
       WORKING-STORAGE SECTION.

       01  EMPLOYEE-TABLE.
           05  EMP-ENTRY OCCURS 5 TIMES INDEXED BY EMP-IDX.
               10  EMP-ID     PIC 9(05).
               10  EMP-NAME   PIC X(20).
               10  EMP-HOURS  PIC 9(03).
               10  EMP-RATE   PIC 9(03)V99.

       01  WS-GROSS           PIC 9(06)V99.
       01  WS-TAX             PIC 9(06)V99.
       01  WS-NET             PIC 9(06)V99.
       01  WS-TOTAL-NET       PIC 9(08)V99 VALUE 0.
       01  WS-COUNT           PIC 9(04)   VALUE 0.

       01  PRINT-LINE.
           05  FILLER         PIC X(03) VALUE SPACES.
           05  PR-ID          PIC 9(05).
           05  FILLER         PIC X(02) VALUE SPACES.
           05  PR-NAME        PIC X(20).
           05  FILLER         PIC X(02) VALUE SPACES.
           05  PR-GROSS       PIC ZZZ,ZZ9.99.
           05  FILLER         PIC X(02) VALUE SPACES.
           05  PR-TAX         PIC ZZZ,ZZ9.99.
           05  FILLER         PIC X(02) VALUE SPACES.
           05  PR-NET         PIC ZZZ,ZZ9.99.

       01  PRINT-TOTAL.
           05  FILLER         PIC X(24) VALUE "  TOTAL NET PAYOUT  : ".
           05  PT-TOTAL       PIC Z,ZZZ,ZZ9.99.

       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM LOAD-EMPLOYEES.

           DISPLAY "================================================".
           DISPLAY "     WEEKLY PAYROLL REPORT - GETLABS INC.       ".
           DISPLAY "================================================".
           DISPLAY "   ID    NAME                    GROSS       "
                   "TAX         NET".
           DISPLAY "------------------------------------------------".

           PERFORM VARYING EMP-IDX FROM 1 BY 1 UNTIL EMP-IDX > 5
               PERFORM PROCESS-RECORD
           END-PERFORM.

           DISPLAY "------------------------------------------------".
           DISPLAY "  EMPLOYEES PROCESSED: " WS-COUNT.
           MOVE WS-TOTAL-NET TO PT-TOTAL.
           DISPLAY PRINT-TOTAL.
           DISPLAY "================================================".
           STOP RUN.

       LOAD-EMPLOYEES.
           MOVE 10001  TO EMP-ID    (1).
           MOVE "ALICE ANDERSON" TO EMP-NAME  (1).
           MOVE 40     TO EMP-HOURS (1).
           MOVE 25.00  TO EMP-RATE  (1).

           MOVE 10002  TO EMP-ID    (2).
           MOVE "BOB BROWN"      TO EMP-NAME  (2).
           MOVE 45     TO EMP-HOURS (2).
           MOVE 18.75  TO EMP-RATE  (2).

           MOVE 10003  TO EMP-ID    (3).
           MOVE "CAROL CHEN"     TO EMP-NAME  (3).
           MOVE 50     TO EMP-HOURS (3).
           MOVE 32.00  TO EMP-RATE  (3).

           MOVE 10004  TO EMP-ID    (4).
           MOVE "DAVID DIAZ"     TO EMP-NAME  (4).
           MOVE 38     TO EMP-HOURS (4).
           MOVE 27.50  TO EMP-RATE  (4).

           MOVE 10005  TO EMP-ID    (5).
           MOVE "EVE EVANS"      TO EMP-NAME  (5).
           MOVE 42     TO EMP-HOURS (5).
           MOVE 21.00  TO EMP-RATE  (5).

       PROCESS-RECORD.
           COMPUTE WS-GROSS = EMP-HOURS(EMP-IDX) * EMP-RATE(EMP-IDX).
           IF WS-GROSS > 500.00
               COMPUTE WS-TAX = WS-GROSS * 0.25
           ELSE
               COMPUTE WS-TAX = WS-GROSS * 0.15
           END-IF.
           COMPUTE WS-NET = WS-GROSS - WS-TAX.
           ADD WS-NET TO WS-TOTAL-NET.
           ADD 1       TO WS-COUNT.

           MOVE EMP-ID   (EMP-IDX) TO PR-ID.
           MOVE EMP-NAME (EMP-IDX) TO PR-NAME.
           MOVE WS-GROSS           TO PR-GROSS.
           MOVE WS-TAX             TO PR-TAX.
           MOVE WS-NET             TO PR-NET.
           DISPLAY PRINT-LINE.
