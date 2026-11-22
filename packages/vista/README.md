<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Vista

> **Call VistA's RPCs over HTTPS, the RPC Broker's messages byte for byte — zero runtime dependencies.**

Each call is one `POST /rpc` to Janus. The body is a broker message, the
same bytes CPRS writes. Janus hands it to the session's em process, where
VistA's own broker runs it. The reply comes back unchanged and is decoded
here. Each session sends one request at a time, in order. The contract is
OpenVista's `docs/RPC-HTTPS.md`: §3 covers the messages and §4 the sign-on.

**Runtime:** browser-safe (`rip.browser: true`). One `.rip` file. Under Bun
it works the same: pass `url:` and it carries the session token itself.

## Quick Start

```coffee
import vista from 'rip/vista'

intro = vista.connect!                    # TCPConnect + XUS SIGNON SETUP → intro text
me = vista.signOn! access, verify         # XUS AV CODE → { duz, mustChangeVerify, … }
vista.changeVerify! verify, fresh, fresh if me.mustChangeVerify
vista.context! 'OR CPRS GUI CHART'        # XWB CREATE CONTEXT
vista.keepalive! onError: report          # XWB IM HERE at half the idle timeout

pt = vista.rpc! 'ORWPT SELECT', dfn       # the data, as VistA returns it
rows = vista.lines! 'ORQQAL LIST', dfn    # the data split on \r\n

vista.bye!                                # #BYE#: VistA logs the user out
```

`vista` is the page's own session (same origin, the browser's cookie). For a
script or a test, make one with the site's address:

```coffee
s = vista.session url: 'https://vista.example.org'
```

The address must be `https:`. Codes travel as written, and TLS is what
protects them, so plain `http:` is accepted only for a loopback dev
server. Redirects are refused, so the token and codes go only where the
session points.

**Keepalive** runs only while the user is active. Start it after sign-on,
when the idle timeout is the user's own, and call `stopKeepalive` when the
user goes idle. A tick runs on a timer, where nothing awaits it, so
`onError` is required: a failed tick goes there. A transient failure keeps
the timer, and the session's end stops it.

A request belongs to the session it was sent on. One still in flight when
`connect` starts a new session fails as `ended`, and its answer never ends
or re-keys the new one.

## A browser's connections

A browser can hold several connections, one per tab and patient. Each one
is its own em process, with its own locks.

- **The secret stays out of reach of script.** The connections share
  Janus's HttpOnly cookie, the one secret, and the browser sends it itself.
- **Each connection has a number.** Janus mints it for the connection
  (`OV-Session`), and it is useless without the cookie.
  - `session.connection` holds it.
  - `resume(number, patient)` names a connection again after a reload,
    sending nothing.
- **Later connections sign on with a handle**, so no codes are typed
  twice:

```coffee
h = vista.handle!                         # XUS GET TOKEN → '~1…', one try, seconds to live
s = vista.session()                       # a new connection: TCPConnect, then XUS SIGNON SETUP
s.send! vista.encodeCommand('TCPConnect', ['127.0.0.1', 0, 'localhost'])
s.rpc! 'XUS SIGNON SETUP'
s.signOnHandle! h                         # XUS AV CODE with the handle, as is
s.context! 'OR CPRS GUI CHART'
s.rpc! 'ORWPT SELECT', dfn                # binds s to dfn
vista.swap s                              # vista takes the new connection; s now holds the old
s.bye!                                    # the old connection ends, and its locks with it
```

- **Handles.** Kernel deletes a handle at its first try, and a refused one
  counts as a failed sign-on from the address, so never send one twice.
  Keep it in memory only.
- **A connection serves one patient.**
  - Its first `ORWPT SELECT` binds it.
  - `patientRpc(dfn, name, …)` and `patientLines` send the DFN with the
    RPC (`OV-Patient`).
  - A DFN other than the bound one is refused before anything is sent
    (kind `patient`), as Janus refuses it.
  - An unbound connection takes any DFN, so the patient list can read
    before a patient is opened.
- **`swap(other)`** trades connections between two sessions, and requests
  queued on either fail as `ended`.
- **`endAll`** sends one `#BYE#` with `OV-End: all`, which ends every
  connection under the cookie (every tab's) and answers how many ended.

## Parameters

| Value | Sent as |
|---|---|
| a string, or a finite number in plain decimal form | a literal |
| `null` / `undefined` / `''` | an empty literal (later parameters keep their places) |
| `{1: 'a', TEXT: 'b'}` | a list: M canonical numbers bare, anything else quoted (`"TEXT"`, `"0.5"`) |
| `[[['TEXT', 1, 0], 'line']]` | a list with multi-level subscripts (`"TEXT",1,0`) |
| `{}` or `[]` | an empty list |

Each argument after the RPC name is one parameter, so spread an array of
separate values (`vista.rpc! 'X', ...args`). An array passed as one
argument is a single list, read as `[subscript, value]` pairs.

A number goes out as JavaScript writes it (`0.5`), as CPRS sends one. A
subscript is the exception: a numeric one takes M's canonical form
(`.5`), because M compares subscripts as strings and `"0.5"` is not `.5`.
A subscript level is never empty (M rejects `""`).

Anything else rejects before a byte is sent: a boolean, a `Date`, `Map` or
other non-plain object, a nested object, or a number with no plain form
(`1e21`). Reference and global-array parameters are not offered.

Text travels as **Windows-1252**, as CPRS writes VistA's text, and every
length counts those bytes. A character the code page cannot hold (`漢`,
`🙂`) is an error, never a `?`.

Codes, a context option and an electronic signature reach Kernel's DECRYP
wrapped in one space. Equal first and last characters translate nothing,
so the value arrives as sent. `wrap` does this for RPCs such as
`TIU SIGN RECORD`:

```coffee
vista.rpc! 'TIU SIGN RECORD', ien, vista.wrap(code)
```

## Errors

Every failure is a `VistaError` with a `kind`:

| kind | When |
|---|---|
| `request` | a message this package will not build (a bad parameter, an unencodable character, over 1 MiB, a site url that is not https) |
| `security` | the broker refused to run the RPC (not signed on, no context, OpenVista's guards) |
| `error` | the RPC's error message |
| `m` | an M error; `detail` holds its full text |
| `signon` | `TCPConnect` rejected, codes, a handle or a new verify code not accepted, no handle given, or a context not created |
| `patient` | a patient's RPC on a connection open for another patient; nothing was sent (`dfn`, `patient`) |
| `ended` | the session is over: Janus's 401, a 502, a 504 with `OV-Session-Ended`, a reply cut short, or `#BYE#`. `sessionEnded` says why: Janus's `OV-Session-Ended` when it sent one. Later calls fail at once until `connect` |
| `transport` | the request never reached Janus, a 504 without `OV-Session-Ended` (it waited in the session's queue past its limit and was never sent), another status (`retryAfter` with it), or a reply that is not `application/x-xwb`; the session stays |
| `reply` | bytes that are not one broker reply; the session ends |

An answer from Janus puts its HTTP `status` on the error. A sign-on screen
reads it to tell a request Janus never sent (a 401, a 503, a 504 without
`OV-Session-Ended`) from one that may have run.

An error never quotes a code, a handle or a signature, not even one character of it.
The session token stays off the session object, so printing or serializing
a session never shows it.

## Messages

`encode`, `encodeCommand` and `decode` are the wire format by themselves,
for a relay or a test:

```coffee
import { encode, decode, wrap } from 'rip/vista'

encode 'XUS AV CODE', [wrap('ACCESS;VERIFY')]   # [XWB]11302 \x010 \x0BXUS AV CODE 5 0015 " ACCESS;VERIFY " f \x04
decode bytes                                    # { security, error, data, mError }
```

## Test

```bash
bun run test
```

The suite checks requests and replies against the contract's bytes, which
were measured on em, and lists in the form CPRS writes. It drives sessions
through a recording fetch: sign-on and token rotation, every error kind,
the session's end, in-order requests, the keepalive lifecycle and `#BYE#`;
and a browser's connections: numbers, handles, patient binding, `swap` and
`endAll`.
