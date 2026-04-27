      ******************************************************************
      * INVENTORY-ISAM.COB - Indexed file demonstration.
      *   Simulates VSAM/ISAM by using an indexed file with SKU as the
      *   primary key. Shows WRITE, READ (random), and REWRITE.
      *
      * Compile: cobc -x -o inventory inventory-isam.cob
      * Run:     ./inventory
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVENTORY-ISAM.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT STOCK-FILE ASSIGN TO "STOCK.IDX"
               ORGANIZATION  IS INDEXED
               ACCESS MODE   IS RANDOM
               RECORD KEY    IS SK-SKU
               FILE STATUS   IS WS-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  STOCK-FILE.
       01  STOCK-RECORD.
           05  SK-SKU          PIC X(08).
           05  SK-DESC         PIC X(30).
           05  SK-QTY          PIC 9(05).

       WORKING-STORAGE SECTION.
       01  WS-STATUS           PIC XX    VALUE "00".
       01  WS-COUNT            PIC 9(04) VALUE 0.

       PROCEDURE DIVISION.
       MAIN-PARA.
           DISPLAY "=== INVENTORY-ISAM DEMO ===".

           OPEN OUTPUT STOCK-FILE.
           IF WS-STATUS NOT = "00"
               DISPLAY "ERROR opening output: " WS-STATUS
               STOP RUN
           END-IF.

           PERFORM LOAD-STOCK.
           CLOSE STOCK-FILE.

           OPEN I-O STOCK-FILE.
           MOVE "SKU00002" TO SK-SKU.
           READ STOCK-FILE.
           IF WS-STATUS = "00"
               DISPLAY "Before: " STOCK-RECORD
               ADD 100 TO SK-QTY
               REWRITE STOCK-RECORD
               DISPLAY "After : " STOCK-RECORD
           ELSE
               DISPLAY "Key not found, status=" WS-STATUS
           END-IF.
           CLOSE STOCK-FILE.

           DISPLAY "DONE. Records loaded=" WS-COUNT.
           STOP RUN.

       LOAD-STOCK.
           MOVE "SKU00001"       TO SK-SKU.
           MOVE "WIDGET"         TO SK-DESC.
           MOVE 50               TO SK-QTY.
           WRITE STOCK-RECORD.
           ADD 1 TO WS-COUNT.

           MOVE "SKU00002"       TO SK-SKU.
           MOVE "SPROCKET"       TO SK-DESC.
           MOVE 120              TO SK-QTY.
           WRITE STOCK-RECORD.
           ADD 1 TO WS-COUNT.

           MOVE "SKU00003"       TO SK-SKU.
           MOVE "FLANGE"         TO SK-DESC.
           MOVE 75               TO SK-QTY.
           WRITE STOCK-RECORD.
           ADD 1 TO WS-COUNT.
