import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const config=JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG,'utf8')),base=config.public_url;
const assert=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const decode=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
async function access(scope) {
  const metadata={client_name:'Desk OOS research scope acceptance',redirect_uris:['https://example.invalid/oos-research-test'],
    grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope};
  const registration=await fetch(`${base}/oauth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(metadata)});
  assert(registration.status===201,'RESEARCH_DCR_FAILED');const client=await registration.json();
  const verifier=randomBytes(32).toString('base64url'),state=randomBytes(16).toString('hex');
  const params={client_id:client.client_id,redirect_uri:metadata.redirect_uris[0],scope,resource:`${base}/mcp`,
    response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),state,
    pin:process.env.DESK_OAUTH_ADMIN_PIN || process.env.DESK_MCP_OAUTH_PIN};
  assert(params.pin,'RESEARCH_OAUTH_PIN_NOT_CONFIGURED');
  const authorization=await fetch(`${base}/oauth/authorize`,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
  assert(authorization.status===303,'RESEARCH_AUTHORIZATION_FAILED');const location=new URL(authorization.headers.get('location'));
  assert(location.searchParams.get('iss')===base && location.searchParams.get('state')===state && location.searchParams.has('code'),'RESEARCH_AUTHORIZATION_BINDING_FAILED');
  const exchange=await fetch(`${base}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:params.redirect_uri,
      code:location.searchParams.get('code'),code_verifier:verifier,resource:params.resource})});
  assert(exchange.status===200,'RESEARCH_TOKEN_FAILED');const token=await exchange.json(),claims=decode(token.access_token);
  assert(token.iss===base && claims.iss===base && claims.aud===`${base}/mcp`,'RESEARCH_TOKEN_AUDIENCE_FAILED');
  return token.access_token;
}
async function mcp(token,work) {
  const client=new Client({name:'Research OAuth scope verifier',version:'1'});
  try {await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`),{requestInit:{headers:{authorization:`Bearer ${token}`}}}));return await work(client);}
  finally{await client.close();}
}
try {
  const denied=await fetch(`${base}/mcp`);assert(denied.status===401 && denied.headers.get('www-authenticate')?.includes('resource_metadata='),'RESEARCH_AUTH_CHALLENGE_FAILED');
  const token=await access('desk.read desk.write');let cycle_id,tools;
  await mcp(token,async client=>{
    tools=(await client.listTools()).tools.length;
    const result=await client.callTool({name:'start_research_cycle',arguments:{dates:['2026-07-02'],budget:{maximum_model_calls:100}}});
    assert(!result.isError,'RESEARCH_OAUTH_WRITE_FAILED');cycle_id=result.structuredContent.cycle_id;
    assert(!(await client.callTool({name:'get_research_status',arguments:{cycle_id}})).isError,'RESEARCH_OAUTH_READ_FAILED');
  });
  await mcp(await access('desk.read'),async client=>assert((await client.callTool({name:'start_research_cycle',arguments:{dates:['2026-07-02'],budget:{maximum_model_calls:100}}})).isError,'RESEARCH_READ_SCOPE_WRITE_ALLOWED'));
  await mcp(await access('desk.write'),async client=>assert((await client.callTool({name:'get_research_status',arguments:{cycle_id}})).isError,'RESEARCH_WRITE_SCOPE_READ_ALLOWED'));
  console.log(JSON.stringify({oauth:'PASS',dcr:'PASS',pkce_s256:'PASS',issuer_audience:'PASS',desk_read:'PASS',desk_write:'PASS',scope_isolation:'PASS',public_tools_count:tools,cycle_id,secrets_logged:false}));
}catch(error){console.error(JSON.stringify({code:error.code??'RESEARCH_OAUTH_ACCEPTANCE_FAILED'}));process.exitCode=1;}
