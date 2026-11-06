import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import "./file-rules.js";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  const reply = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  try {
    if (request.method !== "POST")
      return reply({ error: "Método no permitido" }, 405);
    const url = Deno.env.get("SUPABASE_URL")!,
      anon = Deno.env.get("SUPABASE_ANON_KEY")!,
      authorization = request.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(authorization.replace(/^Bearer /i, ""));
    if (authError || !user) return reply({ error: "Sesión no válida" }, 401);
    // Existing table RLS also validates the immutable GitHub identity.
    const { data: state, error } = await userClient
      .from("planner_state")
      .select("work_state")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !state) return reply({ error: "Acceso no autorizado" }, 403);
    const limit =
      Math.min(
        50,
        Math.max(1, Number(state.work_state?.settings?.maxFileMB) || 50),
      ) *
      1024 *
      1024;
    if (Number(request.headers.get("content-length")) > limit + 65536)
      return reply({ error: "Archivo demasiado grande" }, 413);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Falta el archivo" }, 400);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit + 65536) {
        await reader.cancel();
        return reply({ error: "Archivo demasiado grande" }, 413);
      }
      chunks.push(value);
    }
    const payload = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk, offset);
      offset += chunk.length;
    }
    const body = await new Response(payload, {
        headers: { "Content-Type": request.headers.get("Content-Type") || "" },
      }).formData(),
      file = body.get("file");
    if (!(file instanceof File) || file.size > limit)
      return reply({ error: "Archivo no válido o demasiado grande" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    // @ts-ignore Shared browser/server validator exposes a global namespace.
    const { extension, mime } = globalThis.WorkFiles.validate(
      file.name,
      bytes,
      limit,
      state.work_state?.settings?.extensions,
    );
    const id = crypto.randomUUID(),
      path = `${user.id}/${id}.${extension}`;
    const storage = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { error: uploadError } = await storage.storage
      .from("planner-files")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) throw Error(uploadError.message);
    return reply({
      id,
      path,
      name: file.name.replace(/[\x00-\x1f]/g, "").slice(0, 240),
      size: file.size,
      mime,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return reply(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el archivo",
      },
      400,
    );
  }
});
