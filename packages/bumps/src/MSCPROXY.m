MSCPROXY(port) ;;JUMPS Proxy Server v2.v for Cache ; 01/23/2006
 ;;JUMPS Version 2.4 - Copyright (c) Medsphere 2005. All rights reserved
 ;;
 ;;To port this routine to other platforms, the target platform must support TCP/IP server sockets
 ;;and the code between the --{START | END }CACHE SPECIFIC-- tags may need to be modified
 ;;Beyond that the following no standard M /commands are utilized:
 ;; $ZT    - Sets the error trap handler - utilized throughout
 ;; ZN     - Changes namespace - used in the "worker" subroutine
 ;; ZK     - Kill a node without killing descendents - used in deleteValue
 ;; "W -3" - flushes the TCP/IP buffer - used in the "writeStr" subroutine
 ;;
 ;;
 New io,x
 Kill ^MSCPROXY("LOG")
 Set:$Get(port)="" port=8001
 ;--START CACHE SPECIFIC--
 ;
 Set io="|TCP|"_port
 Open io:(:port:"SA"::32767:32767):200
 ;
 ;--END CACHE SPECIFIC--
 Else  Set ^MSCPROXY("LOG",$Horolog)="Could not start SparseDB Proxy on port '"_port_"'" Quit
 Set ^MSCPROXY("LOG",$Horolog)="SparseDB Proxy started on port '"_port_"'"
 ;
accept ;accept incomming connections
 Set $Zt="acpterr"
 ;--START CACHE SPECIFIC--
 ;
 Use io Read x ;Read for accept
 Job worker:(:5:io:io) ;Concurrent server bit is on
 ;
 ;--END CACHE SPECIFIC--
 Goto accept
 ;
 ;
acpterr
 Set ^MSCPROXY("LOG",$Horolog)="ACCEPT ERROR: "_$Ze
 Set $Ecode=""
 Goto accept
 ;
nserr
 Set ^MSCPROXY("LOG",$Horolog)="INVALID NAMESPACE ERROR: "_$Get(x)
 Do writeStr("1")
 Quit
 ;
worker ;handles the client requests
 New debug,x,y,func,params,authed,username,rSep,pSep,lSep
 ;Use $Io:(::"-M")
 Do symbInit
 Set authed=0       ;if any method is called before authenticate then the job will terminate
 Set username=""
 Do writeStr("server=mumps;format=string;cs=iso-8859-1") ; use string version of protocol
 ;
workLoop
 Set $Zt="workErr"
 Set params=$$readPkt()
 Set func=$$nextItem(.params)
 Set x=$Get(funcTbl(func))
 If x="" Do return(STOREERRORUNSUPPORTED,"Unsupported function ("_func_")") Goto workLoop
 Set x=x_"(params)"
 Do @x
 Kill params
 Goto workLoop
 ;
workErr
 Set $ztrap="workErrErr"
 Set ^MSCPROXY("LOG",$Job)=$Get(func)_"::"_$Ze
 Do return(1004,$ze)
 Hang 2
workErrErr
 Halt
 ;
 ;
 ;M functions that actually do the work --- plus some helpers
 ;
auth(params) ;add custom authentication code as appropriate
 ;return 0 to terminate the session
 ;if the client is unexpected terminated it will attempt
 ;to reconnect and re-authenticate.
 ; returning 0 instead of just disconnecting prevents the automatic retrys
 ;
 New namespace,password
 Set namespace=$$nextItem(.params)
 Set username=$$nextItem(.params)
 Set password=$$nextItem(.params)
 If $Get(namespace)'="" ZN namespace
 ;do your stuff
 Set authed=1
 Do return(0,$Job)
 Quit
 ;
delete(params)
 New what
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 Set:$Extract(what)'="^" what="^"_what
 If '$$inChgSandbox(what) Do return(STOREERRORILLEGAL) Quit
 Kill @what
 Do return(0)
 Quit 1
 ;
chgNS(params)
 New what
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 ZN what
 Do return(0)
 Quit
 ;
getNS(params)
 New what
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 ZN what
 Do return(0,$znspace)
 Quit
 ;
getNSN(params)
 New what
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 ZN what
 Do return(1)
 Quit
 ;
delValue(params)
 New what
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 Set:$Extract(what)'="^" what="^"_what
 If '$$inChgSandbox(what) Do return(STOREERRORILLEGAL) Quit
 ZK @what
 Do return(0)
 Quit
 ;
exeFunc(params)
 New what,x,len,args
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 If $Piece(what,"^",2)="" Set what=$g(funcTbl(what))
 If $Piece(what,"^",2)="" Do return(STOREERRORILLEGAL) Quit
 If '$$inExeSandbox(what) Do return(STOREERRORILLEGAL) Quit
 Set what=what_"("
 For   Quit:params=""  Set args=$$nextItem(.params) Set what=what_""""_args_""","
 Set len=$length(what)
 Set:len $e(what,len)=""
 Set x="x=$$"_what_")"
 Set ^MSCPROXY("EXE")=x
 Set @x
 Do return(0,x)
 Quit
 ;
exists(params)
 New what,x
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 Set:$Extract(what)'="^" what="^"_what
 If '$$inReadSandbox(what) Do return(STOREERRORILLEGAL) Quit
 Set x=$Data(@what)
 Do return(0,x)
 Quit
 ;
nextBlock(params)
 New what,x,block,i,size,d,cx,dd,dir
 Do thisInit
 Set $Zt="funcerr"
 Set cx=$$nextItem(.params)
 Set block=$$nextItem(.params)
 Set dir=1
 Set what=$$rvtKey(cx)
 If '$$inReadSandbox(what) Do return(STOREERRORILLEGAL) Quit
 If 'dir Set dir=1
 Do return(0)
 Set size=5,i=0
 For  Do  Quit:x=""
 . Set x=$Query(@what,dir)
 . If x="" Do writeEx(nullString) Quit  ;end of data
 . Set cx=$$cvtSym(x)
 . Set d=@x
 . Set size=size+$Length(cx)+$Length(d)+6
 . If size>block Do  Set x="" Quit
 . . Do writeStr(cx),writeEx(nullString)
 . . Quit
 . Do writeStr(cx,1)
 . Do writeStr(d)
 . Set what=x,i=i+1
 . Quit
 Quit
 ;
get(params)
 New what,x
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 Set:$Extract(what)'="^" what="^"_what
 If $Extract(what,1,9)="^$REC(-1," Quit $$recordGet(what)
 If '$$inReadSandbox(what) Do return(STOREERRORILLEGAL) Quit
 If $Data(@what,x)#10=0 Do returnNull(0) Quit
 Do return(0,x)
 Quit
 ;
getM(params)
 New what,x,len,null
 Do thisInit
 Set $Zt="errHalt"
 Do return(0)
 For  Do  Quit:what=""
 . Set what=$$readStr(.null)
 . Quit:what=""
 . Set:$Extract(what)'="^" what="^"_what
 . If '$$inReadSandbox(what) Do return(STOREERRORILLEGAL) Quit
 . Set x=nullString
 . If $Data(@what,x)
 . If x=nullString Do writeEx(x)
 . Else  Do writeStr(x)
 . Quit
 Do flush
 Quit
 ;
lock(params)
 New type,what,timeout,y,var,shared,len
 Do thisInit
 Set $Zt="funcerr"
 Set type=+$$nextItem(.params)
 Set var=$Select(type=1:"+(",type=2:"-(",1:"(")
 If (var="(") Lock
 Set len=$$getLen(.params)
 For i=1:1:len Do
 . Set var=var_$$rvtKey($$nextItem(.params))_","
 . Quit
 Set $Extract(var,$Length(var))=")"
 Set timeout=+$$nextItem(.params)
 Set shared=+$$nextItem(.params)
 Set:(timeout>-1) var=var_":"_(timeout/1000)
 Set:shared var=var_"#S"
 Set y=1
 Lock @var
 Set y=$Test
 If (timeout=-1) Set y=1
 Do return(0,y)
 Quit
 ;
copy(params)
 New source,dest
 Do thisInit
 Set $Zt="funcerr"
 Set source=$$nextItem(.params)
 Set dest=$$nextItem(.params)
 Set:$Extract(dest)'="^" dest="^"_dest
 Set:$Extract(source)'="^" source="^"_source
 If '$$inChgSandbox(dest) Do return(STOREERRORILLEGAL) Quit
 If '$$inReadSandbox(source) Do return(STOREERRORILLEGAL) Quit
 Merge @dest=@source
 Do return(0)
 Quit
 ;
copyVal(params)
 New source,dest,y
 Do thisInit
 Set source=$$nextItem(.params)
 Set dest=$$nextItem(.params)
 Set:$Extract(dest)'="^" dest="^"_dest
 Set:$Extract(source)'="^" source="^"_source
 Set y=0
 If '$$inChgSandbox(dest) Do return(STOREERRORILLEGAL) Quit
 If '$$inReadSandbox(source) Do return(STOREERRORILLEGAL) Quit
 Set:$Data(@source,@dest)#2=1 y=1
 Do return(0,y)
 Quit
 ;
nextSub(params)
 New what,dir,x
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 Set:$Extract(what)'="^" what="^"_what
 Set dir=+$$nextItem(.params)
 Set dir=$Select(dir<0:-1,1:1)
 If '$$inReadSandbox(what) Do return(STOREERRORILLEGAL) Quit
 If $p(what,"(",2)="" Do  Quit
 .Set x=$Order(^$g(what),dir)
 .If x="" Do returnNull(0) Quit
 .Set:$Extract(x)="^" $Extract(x)=""
 .Do return(0,x)
 .Quit
 Set x=$Order(@what,dir)
 If x="" Do returnNull(0) Quit
 Set:$E(what,1,2)'="^$" x=$zr
 Set:$Extract(x)="^" $Extract(x)=""
 Do return(0,x)
 Quit
 ;
nextNode(params)
 New what,dir,x
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 Set dir=+$$nextItem(.params)
 Set dir=$Select($Get(dir)<0:-1,1:1)
 Set:$Extract(what)'="^" what="^"_what
 If '$$inReadSandbox(what) Do return(STOREERRORILLEGAL) Quit
 Set x=$Query(@what,dir)
 Set:$Extract(x)="^" $Extract(x)=""
 Do return(0,x)
 Quit
 ;
nextPair(params)
 New what,x,y,dir,getentry
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 Set dir=+$$nextItem(.params)
 If 'dir Set dir=1
 Set:$Extract(what)'="^" what="^"_what
 If '$$inReadSandbox(what) Do return(STOREERRORILLEGAL) Quit
 Set x=$Query(@what,dir)
 If (x="") Do returnNull(0) Quit
 Set y=$Get(@x)
 Set:$Extract(x)="^" $Extract(x)=""
 Do return(0,x,y)
 Quit
 ;
setM(params)
 New what,toWhat,x,null
 Do thisInit
 Do return(0)
 Set $Zt="errHalt"
 For  Do  Quit:what=""
 . Set what=$$readStr(.null)
 . Quit:what=""
 . Set what=$$rvtKey(what)
 . Set toWhat=$$readStr(.null)
 . If '$$inChgSandbox(what) Set what="" Do return(STOREERRORILLEGAL) Quit
 . If null Kill @what
 . Else  Set @what=toWhat
 Do return(0)
 Quit
 ;
set(params)
 New what,toWhat
 Do thisInit
 Set $Zt="funcerr"
 Set what=$$nextItem(.params)
 Set:$Extract(what)'="^" what="^"_what
 Set toWhat=$$nextItem(.params)
 If '$$inChgSandbox(what) Do return(STOREERRORILLEGAL) Quit
 Set @what=toWhat
 Do return(0)
 Quit
 ;
unlock(params)
 New what,var,i,len
 Do thisInit
 Set $Zt="funcerr"
 Set len=$$getLen(.params)
 For i=1:1:len Do
 . Set var="-"_$$rvtKey($$nextItem(.parms))
 . Lock @var
 . Quit
 Do return(0)
 Quit
 ;
unlockA(params)
 Do thisInit
 Lock
 Do return(0)
 Quit
 ;
exit(params)
 Do thisInit
 H
 ;
funcerr
 Set ^MSCPROXY("LOG","ERR",$Horolog)=$Get(params)_":"_$Get(what)_":"_$Ze
 Set ec=$Piece($Piece($ze,"<",2),"<")
 Set re=STOREERRORSYNTAX
 If ec="UNDEFINED" Set re=STOREERRORUNDEFINED
 Else  If ec="SYNTAX" Set re=STOREERRORSYNTAX
 Else  If ec="ILLEGAL VALUE" Set re=STOREERRORILLEGALVALUE
 Else  If ec="NAMESPACE" Set re=STOREERRORUNDEFINED,msg="The specified namespace does not exist"
 If $Data(msg) Do return(re,msg)
 Else  Do return(re)
 Quit
 ;
errHalt ; called when our only recourse is to halt
 Set ^MSCPROXY("LOG","ERR",$Horolog)=$Get(func)_":"_$Get(params)_":"_$Get(what)_":"_$Ze
 H
 ;
thisInit
 Set $Ecode=""
 If authed=0 Halt    ;terminate the process
 Quit
 ;
rvtKey(x)
 Set:$Extract(x)'="^" x="^"_x
 Quit x
 ;
cvtSym(x)
 Set:$Extract(x)="^" $Extract(x)=""
 Quit x
 ;
return(code,x,y)
 Set out=$$lenEnc($Length(code))_code
 Set:$Data(x) out=out_$$lenEnc($Length(x))_x
 Set:$Data(y) out=out_$$lenEnc($Length(y))_y
 Write $$len4B($Length(out)),out
 Write *-3
 Quit
returnNull(code)
 Set out=$$lenEnc($Length(code))_code_nullString
 Write $$len4B($Length(out)),out
 Write *-3
 Quit
mreturn(code,x,y)
 Set out=$$lenEnc($Length(code))_code
 Set:$Data(x) out=out_$$lenEnc($Length(x))_x
 Set:$Data(y) out=out_$$lenEnc($Length(y))_y
 Quit $$len4B($Length(out))_out
 ;
readPkt() ;reads the incoming data packet from the socket
 New x,len,i,n
 Read x#4
 Set len=$Length(x)
 If len'=4 Do readPkt(1)  ;forces and invalid parameter error
 Set len=0
 For i=1:1:4 Set len=(len*256)+$Ascii(x,i)
 Read x#len
 Quit x
 ;
readStr(readStrNull) ;reads the incoming string data block from the socket
 New x,len,i,n
 Set readStrNull=0
 Read x#1
 Set len=$Ascii(x)
 Quit:len=0 ""
 If len=128 Set readStrNull=1 Quit ""
 If len>127 Do
 . Set len=len-128
 . If len>3 Do readPkt(1)  ;forces and invalid parameter error
 . Read x#len
 . Set n=0
 . For i=1:1:len Set n=(n*256)+$Ascii(x,i)
 . Set len=n
 Read x#len
 Quit x
 ;
writePkt(x) ;writes a data packet
 Set len=$Length(x)
 Set len=$Char((len\16777216)#256,(len\65536)#256,(len\256)#256,len#256)
 Write len,x,*-3
 Quit
 ;
len4B(len) ;writes a data packet
 Quit $Char((len\16777216)#256,(len\65536)#256,(len\256)#256,len#256)
 ;
writeStr(x,noflush) ;writes data to the socket
 Write $$lenEnc($Length(x))
 Write x
 If '$Get(noflush) Write *-3   ;Cache TCP buffer flush
 Quit
 ;
writeEx(x,noflush) ;writes data to the socket
 Write x
 If '$Get(noflush) Write *-3   ;Cache TCP buffer flush
 Quit
 ;
flush
 Write *-3
 ;
lenEnc(len) ;gets the encoding for the length
 If len<0 Quit $Char(128)
 New n,i,size
 If len>127 Do
 . Set n=1
 . Set:len>255 n=2
 . Set:len>65535 n=3
 . ;Set:len>16777215 n=4
 . Set size=$Char(128+n)
 . Set n=n-1
 . For i=n:-1:0 Do
 . . Set size=size_$Char((len\(2**(i*8)))#256)
 . . Quit
 . Quit
 Else  Set size=$Char(len)
 Quit size
 ;
 ;
 ;;Return the length specifier in a string
 ;;Pass in a pointer to x in order to whittle down the string
getLen(x)
 Set len=$Ascii(x)
 Quit:len=-1 -1 ;;no data left
 Quit:len=128 -1 ;;encoded null
 Set n=1
 If len>127 Do
 . Set len=len-128
 . Set n=len+1,len=0
 . For i=2:1:n Set len=(len*256)+$Ascii(x,i)
 . Quit
 Set $Extract(x,1,n)=""
 Quit len
 ;
 ;;Return the length specifier in a string
 ;;Pass in a pointer to x in order to whittle down the string
get4BL(x)
 Set len=$Length(x)
 Quit:len<4 -1 ;;no data left
 Set len=0
 For i=1:1:4 Set len=(len*256)+$Ascii(x,i)
 Set $Extract(x,1,4)=""
 Quit len
 ;
nextItem(x) ;retrieves the next item in the list
 New y
 Set len=$$getLen(.x)
 Quit:len=-1 ""
 Set y=$Extract(x,1,len)
 Set $Extract(x,1,len)=""
 Quit y
 ;
recordGet(what)
 Set $ztrap="recordGetErr"
 Set x=$$proxyGet^MSCRECORD(what)
 Do return(+$p(x,":",1),$p(x,":",2,99))
 Quit
 ;
recordGetErr
 Do return(STOREERRORUNDEFINED)
 Quit
 ;
symbInit
 Set nullString=$Char(128)
 Set FUNCAUTH=1
 Set FUNCGET=2
 Set FUNCGETMULTIPLE=3
 Set FUNCNEXTBLOCK=4
 Set FUNCSET=5
 Set FUNCSETMULTIPLE=6
 Set FUNCDELETE=8
 Set FUNCDELETEMULTIPLE=9
 Set FUNCDELETEVALUE=10
 Set FUNCCOPY=11
 Set FUNCCOPYVALUE=12
 Set FUNCNEXTNODE=13
 Set FUNCNEXTPAIR=14
 Set FUNCNEXTSUBSCRIPT=15
 Set FUNCLOCK=16
 Set FUNCUNLOCK=17
 Set FUNCUNLOCKALL=18
 Set FUNCEXISTS=19
 Set FUNCEXECUTEFUNC=20
 Set FUNCEXIT=21
 Set FUNCCHANGENS=22
 Set FUNCGETNS=23
 Set FUNCGETNSNAMES=24
 ;
 Set STOREERRORUNDEFINED=1000
 Set STOREERRORNULLVALUE=1001
 Set STOREERRORSYNTAX=1002
 Set STOREERRORSYSTEM=1004
 Set STOREERRORDATABASE=1006
 Set STOREERRORUNSUPPORTED=1007
 Set STOREERRORILLEGAL=1009
 ;
 Set funcTbl(FUNCAUTH)="auth"
 Set funcTbl(FUNCGET)="get"
 Set funcTbl(FUNCSETMULTIPLE)="setM"
 Set funcTbl(FUNCGETMULTIPLE)="getM"
 Set funcTbl(FUNCNEXTNODE)="nextNode"
 Set funcTbl(FUNCNEXTSUBSCRIPT)="nextSub"
 Set funcTbl(FUNCDELETE)="delete"
 Set funcTbl(FUNCDELETEVALUE)="delValue"
 Set funcTbl(FUNCDELETEMULTIPLE)="deleteM"
 Set funcTbl(FUNCEXISTS)="exists"
 Set funcTbl(FUNCCOPY)="copy"
 Set funcTbl(FUNCUNLOCKALL)="unlockA"
 Set funcTbl(FUNCUNLOCK)="unlock"
 Set funcTbl(FUNCCHANGENS)="chgNS"
 Set funcTbl(FUNCGETNS)="getNS"
 Set funcTbl(FUNCGETNSNAMES)="getNSN"
 Set funcTbl(FUNCEXIT)="exit"
 Set funcTbl(FUNCLOCK)="lock"
 Set funcTbl(FUNCEXECUTEFUNC)="exeFunc"
 Set funcTbl(FUNCSET)="set"
 Set funcTbl(FUNCNEXTPAIR)="nextPair"
 Set funcTbl(FUNCCOPYVALUE)="copyVal"
 Set funcTbl(FUNCNEXTBLOCK)="nextBlock"
 ;
 ;
 New recordHandler
 Set recordHandler="MSCRECORD"
 Set funcTbl("createRecord")="create^"_recordHandler
 Set funcTbl("readRecord")="read^"_recordHandler
 Set funcTbl("readMultiple")="readMultiple^"_recordHandler
 Set funcTbl("updateRecord")="update^"_recordHandler
 Set funcTbl("deleteRecord")="delete"_recordHandler
 Set funcTbl("searchRecords")="search^"_recordHandler
 Set funcTbl("loginAV")="loginAV^"_recordHandler
 Set funcTbl("loginDUZ")="loginDUZ^"_recordHandler
 Quit
 ;
  ;;
  ;;This method tests whether the specified global is part of this
  ;;environment’s read sandbox. All functions that read globals
  ;;will first call this method before proceeding. If the method
  ;;returns false then the requested action will not be performed.
  ;
  ;;@param gbl  the global to be checked
  ;;@return 1-to proceed; 0-to abort
  ;;
inReadSandbox(gbl)
 Quit 1
 ;;
  ;;This method tests whether the specified global is part of this
  ;;environment’s change sandbox. All functions that change globals
  ;;will first call this method before proceeding. If the method
  ;;returns false then the requested action will not be performed.
  ;
  ;;@param gbl  the global to be checked
  ;;@return 1-to proceed; 0-to abort
  ;;
inChgSandbox(gbl)
 ;Quit $Extract(gbl,1,4)="^MSC"
 Quit 1
 ;
 ;;
  ;;This method tests whether the specified function is part of this
  ;;environment’s execution sandbox. The execute function
  ;;will first call this method before proceeding. If the method
  ;;returns false then the requested action will not be performed.
  ;
  ;;@param func  the function to be checked
  ;;@return 1-to proceed; 0-to abort
  ;;
inExeSandbox(func)
 Quit $p(func,"^MSC",1)'=""
 ;
