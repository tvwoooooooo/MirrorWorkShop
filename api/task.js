// api/task.js
export async function handleTask(request, env) {
  const url = new URL(request.url);
  const taskId = url.pathname.split('/').pop();
  let task = await env.B2_KV.get(`master:${taskId}`, 'json');
  if (!task) {
    task = await env.B2_KV.get(`task:${taskId}`, 'json');
  }
  if (!task) {
    return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 });
  }
  return Response.json(task);
}