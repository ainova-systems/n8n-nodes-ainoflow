import { spawn } from 'node:child_process';

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: 'inherit',
			shell: process.platform === 'win32',
		});

		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) return resolve();
			return reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
		});
	});
}

await run('n8n-node', ['lint']);
await run('n8n-node', ['build']);

