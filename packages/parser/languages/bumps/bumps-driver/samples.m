; Sample exercising ELSE and indirection
IF A>0 WRITE "pos" ELSE WRITE "non-pos"
SET LBL="START", ROU="MYROU"
DO @LBL^(ROU)(1,2)
G @(ROU)
