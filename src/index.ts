import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequest,
	CallToolRequestSchema,
	ListToolsRequestSchema,
	Tool,
} from "@modelcontextprotocol/sdk/types.js";// Create server instance
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import jwt from "jsonwebtoken";

//helper functions
async function getActions(jwt: string): Promise<any | null> {
	try {
		const response = await fetch("https://actionkit.useparagon.com/projects/" + process.env.PARAGON_PROJECT_ID + "/actions", {
			method: "GET",
			headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
		});
		if (!response.ok) {
			throw new Error(`HTTP error; status: ${response.status}`)
		}
		return (await response.json());
	} catch (error) {
		console.error("Could not make ActionKit POST request: " + error);
		return null;
	}
}

async function performAction(actionName: string, actionParams: any, jwt: string): Promise<any | null> {
	try {
		const response = await fetch("https://actionkit.useparagon.com/projects/" + process.env.PARAGON_PROJECT_ID + "/actions", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
			body: JSON.stringify({ action: actionName, parameters: actionParams })
		});
		if (!response.ok) {
			throw new Error(`HTTP error; status: ${response.status}`)
		}
		return (await response.json());
	} catch (error) {
		console.error("Could not make ActionKit POST request: " + error);
		return null;
	}
}


function signJwt(userId: string): string {
	const currentTime = Math.floor(Date.now() / 1000);

	return jwt.sign(
		{
			sub: userId,
			iat: currentTime,
			exp: currentTime + (60 * 60 * 24 * 7), // 1 week from now
		},
		process.env.SIGNING_KEY?.replaceAll("\\n", "\n") ?? "",
		{
			algorithm: "RS256",
		},
	);
}

async function getTools(jwt: string): Promise<Array<any>> {
	const tools: Array<Tool> = [];
	const actionPayload = await getActions(jwt);
	const actions = actionPayload.actions;

	for (const integration of Object.keys(actions)) {
		for (const action of actions[integration]) {
			const tool: Tool = action['function']
			tools.push(tool);
		}
	}
	return tools;
}

async function main() {
	console.error("Starting MCP Server");
	const server = new Server(
		{
			name: "mcp-actionkit",
			version: "1.0.0",
		},
		{
			capabilities: {
				tools: {},
			},
		},
	); const jwt = signJwt("jack.mu@useparagon.com");
	console.error("JWT Created: ", jwt);

	server.setRequestHandler(
		CallToolRequestSchema,
		async (request: CallToolRequest) => {
			console.error("Received CallToolRequest: ", request);
			try {
				if (!request.params.arguments) {
					throw new Error("No arguments provided");
				}
				if (!request.params.name) {
					throw new Error("Tool name is missing");
				}
				const args = request.params.arguments as unknown;
				const toolName = request.params.name;

				const response = await performAction(toolName, args, jwt);
				return { content: [{ text: JSON.stringify(response) }] };
			} catch (error) {
				console.error("Error executing tool: ", error);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		}
	);
	console.error("Tool Call Results Set");


	server.setRequestHandler(ListToolsRequestSchema, async () => {
		const tools = await getTools(jwt);
		console.error("Tools received from ActionKit: ", tools);
		return {
			tools: tools
		};
	});
	console.error("Tool Call Schemas Set");

	const transport = new StdioServerTransport();
	console.error("Connecting server to transport");
	await server.connect(transport);

	console.error("MCP Server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});
