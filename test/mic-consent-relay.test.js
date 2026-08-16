// Verifies the microphone consent gate in agents/meshcore.js.
//
// The gate has been placed in the wrong spot twice: first in onTunnelData,
// which a piped desktop tunnel never reaches, then as a wrapper assigned over
// the KVM stream's write, which is a readonly native property so the
// assignment silently did nothing. Both looked correct by inspection. This
// extracts the relay from the real file and drives it the way pipe() does, so
// "the gate is actually reached" is asserted rather than assumed.
//
// Run: node test/mic-consent-relay.test.js
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'agents', 'meshcore.js'), 'utf8');

const start = src.indexOf('function micCreateConsentRelay');
const end   = src.indexOf('function micConsentHandleStart');
if (start < 0 || end < 0) { console.log('FAIL: relay not found'); process.exit(1); }
const relaySrc = src.slice(start, end);

let consentCalls = 0, consentResult = false, forwarded = [];
function micConsentHandleStart(t) { consentCalls++; return consentResult; }

eval(relaySrc);

const tunnel = { httprequest: { desktop: { kvm: { write: (c) => { forwarded.push(c); return true; } } } } };
const relay = micCreateConsentRelay(tunnel);

const frame = (cmd, len=4) => { const b = Buffer.alloc(len); b[0]=(cmd>>8)&0xFF; b[1]=cmd&0xFF; b[2]=0; b[3]=len; return b; };

let fails = 0;
const check = (c,m) => { console.log((c?'  PASS  ':'  FAIL  ')+m); if(!c) fails++; };

// A mouse move must pass straight through untouched.
forwarded=[]; consentCalls=0;
relay.write(frame(2, 10));
check(consentCalls===0 && forwarded.length===1, 'ordinary KVM input passes through');

// MNG_MIC_START must reach the consent handler and be held.
forwarded=[]; consentCalls=0; consentResult=false;
relay.write(frame(97));
check(consentCalls===1, 'MNG_MIC_START reaches the consent handler');
check(forwarded.length===0, 'MNG_MIC_START is held until consent is given');

// Once consent is granted it should forward.
forwarded=[]; consentCalls=0; consentResult=true;
relay.write(frame(97));
check(forwarded.length===1, 'MNG_MIC_START forwards once consent is granted');

// A browser must never be able to grant consent itself.
forwarded=[]; consentCalls=0;
relay.write(frame(100));
check(forwarded.length===0 && consentCalls===0, 'forged MNG_MIC_CONSENT is dropped');

// Strings and short/odd input must not throw.
forwarded=[];
try {
  relay.write(String.fromCharCode(0,97,0,4));
  relay.write(Buffer.alloc(2));
  relay.write(null);
  check(true, 'string frames and malformed input handled safely');
} catch (e) { check(false, 'threw on odd input: '+e.message); }

console.log(fails ? '\nRELAY BROKEN' : '\nRELAY VERIFIED');
process.exit(fails?1:0);
