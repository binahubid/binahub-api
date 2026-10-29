import {timingSafeEqual} from 'node:crypto';
import {NextRequest} from 'next/server';
import {json,rpc,failure} from '@/lib/peta/http';
export async function POST(req:NextRequest){
 const secret=process.env.CRON_SECRET,actual=req.headers.get('authorization')||'';
 if(!secret||secret.length<32||actual.length!==('Bearer '+secret).length||!timingSafeEqual(Buffer.from(actual),Buffer.from('Bearer '+secret)))return json({success:false,error:'Tidak diizinkan.'},401);
 try{return json({success:true,erased:await rpc('peta_purge_expired',{p_limit:100})});}catch(error){return failure(error);}
}
