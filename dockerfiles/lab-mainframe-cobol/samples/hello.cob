      ******************************************************************
      * HELLO.COB - Minimal COBOL program.
      * Compile: cobc -x -o hello hello.cob
      * Run:     ./hello
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. HELLO.
       AUTHOR.     GETLABS-MAINFRAME-COBOL.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-MESSAGE   PIC X(30) VALUE "Hello from GnuCOBOL on GetLabs".

       PROCEDURE DIVISION.
       MAIN-PARA.
           DISPLAY WS-MESSAGE.
           STOP RUN.
