import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { spinFailure,spinJson } from '@/lib/spin/http';
import { SpinError,SPIN_DEFINITION } from '@/lib/spin/intake';
import { SPIN_INBOX_PAGE_SIZE, SpinInboxQuerySchema, spinContactSearchFilter } from '@/lib/spin/admin-inbox';
export async function GET(req:NextRequest){try{
 const actor=await requireAdmin(req);if('error'in actor)return spinJson({success:false,error:'Akses admin diperlukan.'},actor.status);
 const limited=await enforceRateLimit(req,'spin-admin-read',300,3600);if(limited)return limited;
 const db=createServerSupabase(),id=req.nextUrl.searchParams.get('id');
 if(id){z.uuid().parse(id);const {data,error}=await db.from('spin_submissions').select('id,answers,confirmation,summary,status,contact,marketing_consent,submitted_at,report,internal_report,error_code,created_at,inquiry_id,lead_id,attempts,next_attempt_at').eq('id',id).maybeSingle();
 if(error)throw new SpinError('SPIN_SETUP_REQUIRED');if(!data)throw new SpinError('SPIN_NOT_FOUND');
 const jobs=await db.from('spin_mail_jobs').select('id,status,attempts,provider_id,sent_at,created_at,next_attempt_at').eq('submission_id',id).order('created_at',{ascending:false}).limit(10);
 if(jobs.error)throw new SpinError('SPIN_STORAGE_UNAVAILABLE');
 return spinJson({success:true,record:data,delivery:jobs.data,definition:SPIN_DEFINITION});}
 const {page,search}=SpinInboxQuerySchema.parse({page:req.nextUrl.searchParams.get('page')||0,search:req.nextUrl.searchParams.get('search')||''});
 let query=db.from('spin_submissions').select('id,status,contact,submitted_at,created_at,error_code,inquiry_id,lead_id',{count:'exact'}).not('submitted_at','is',null);
 if(search)query=query.or(spinContactSearchFilter(search));
 const {data,error,count}=await query.order('submitted_at',{ascending:false}).order('id',{ascending:false}).range(page*SPIN_INBOX_PAGE_SIZE,page*SPIN_INBOX_PAGE_SIZE+SPIN_INBOX_PAGE_SIZE-1);
 if(error)throw new SpinError('SPIN_SETUP_REQUIRED');
 if(!Array.isArray(data)||count===null||!Number.isSafeInteger(count)||count<0)throw new SpinError('SPIN_STORAGE_UNAVAILABLE');
 return spinJson({success:true,records:data,total:count,page,searchApplied:true});
}catch(e){return spinFailure(e);}}
