/**
 * Supabase 客户端工厂（Workers 版）
 *
 * 原网关版用 storage/supabase.js 在模块加载时以 .env 创建单例；
 * Workers 无常驻进程，改为按请求用 env 创建。supabase-js 走 HTTPS REST，
 * 与 Workers 运行时天然兼容。
 */
import { createClient } from '@supabase/supabase-js';

export function createSupabase(env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
        throw new Error('未配置 SUPABASE_URL / SUPABASE_KEY');
    }
    return createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
        auth: { persistSession: false },
    });
}
