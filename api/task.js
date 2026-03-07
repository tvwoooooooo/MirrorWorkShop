// api/task.js
import { getMasterTask } from '../lib/taskManager.js';

export async function handleTask(request, env) {
    const url = new URL(request.url);
    const taskId = url.pathname.split('/').pop();
    const task = await getMasterTask(env, taskId);
    if (!task) {
        return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 });
    }
    return Response.json(task);
}