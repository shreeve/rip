; sample.m — quick test file
HELLO  W "Hi",!  S A=1,B(2)="ok"  I A?1A1N W "OK",!  H  ; greet
SETTEST  S A=1,B(10)=2,C=333  ; align equals
READLINE R X S Y=$L(X) W "LEN=",Y,!
NEWLAB   N I,J S I=1,J=2  W I+J,!  Q
