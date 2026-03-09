// api/backup.js
import { startDockerBackupTask } from '../lib/docker.js';

export async function handleDockerBackup(request, env) {
    try {
        const body = await request.json();
        const { imageName, tag, bucketId } = body;

        if (!imageName || !tag || !bucketId) {
            return new Response(JSON.stringify({ error: 'Missing imageName, tag, or bucketId' }), { status: 400 });
        }

        const taskId = crypto.randomUUID();

        // Await the task creation to catch any immediate errors.
        await startDockerBackupTask(env, taskId, imageName, tag, bucketId);

        return new Response(JSON.stringify({ taskId }), { status: 202 });
    } catch (e) {
        console.error('Backup failed:', e);
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
