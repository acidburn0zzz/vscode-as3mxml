/*
Copyright 2016-2017 Bowler Hat LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import * as fs from "fs";
import * as json5 from "json5";
import * as path from "path";
import * as vscode from "vscode";
import getFrameworkSDKPathWithFallbacks from "./getFrameworkSDKPathWithFallbacks";

const ASCONFIG_JSON = "asconfig.json"
const FILE_EXTENSION_AS = ".as";;
const FILE_EXTENSION_MXML = ".mxml";
const CONFIG_AIR = "air";
const CONFIG_AIRMOBILE = "airmobile";
const FIELD_CONFIG = "config";
const FIELD_APPLICATION = "application";
const FIELD_AIR_OPTIONS = "airOptions";
const FIELD_TARGET = "target";
const PLATFORM_IOS = "ios";
const PLATFORM_ANDROID = "android";
const PLATFORM_AIR = "air";
const PLATFORM_WINDOWS = "windows";
const PLATFORM_MAC = "mac";
const TARGET_BUNDLE = "bundle";
const MATCHER = "$nextgenas_nomatch";
const TASK_TYPE = "actionscript";

interface ActionScriptTaskDefinition extends vscode.TaskDefinition
{
	debug: boolean;
	air?: string;
}

export default class ActionScriptTaskProvider implements vscode.TaskProvider
{
	provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]>
	{
		if(vscode.workspace.workspaceFolders === undefined)
		{
			return Promise.resolve([]);
		}
		let workspaceRoot = vscode.workspace.workspaceFolders[0];

		let provideTask = false;
		let isAIRMobile = false;
		let isBundleWindows = false;
		let isBundleMac = false;
		let isAIRDesktop = false;
		let asconfigJsonPath = path.join(workspaceRoot.uri.fsPath, ASCONFIG_JSON);
		if(fs.existsSync(asconfigJsonPath))
		{
			//if asconfig.json exists in the root, always provide the tasks
			provideTask = true;
			let asconfigJson = this.readASConfigJSON(asconfigJsonPath);
			if(asconfigJson !== null)
			{
				isAIRMobile = this.isAIRMobile(asconfigJson);
				isBundleWindows = this.isBundleWindows(asconfigJson);
				isBundleMac = this.isBundleMac(asconfigJson);
				if(!isAIRMobile)
				{
					isAIRDesktop = this.isAIRDesktop(asconfigJson);
				}
			}
		}
		if(!provideTask && vscode.window.activeTextEditor)
		{
			let fileName = vscode.window.activeTextEditor.document.fileName;
			if(fileName.endsWith(FILE_EXTENSION_AS) || fileName.endsWith(FILE_EXTENSION_MXML))
			{
				//we couldn't find asconfig.json, but an .as or .mxml file is
				//currently open, so might as well provide the tasks
				provideTask = true;
			}
		}
		if(!provideTask)
		{
			return Promise.resolve([]);
		}

		let command = this.getCommand();
		let frameworkSDK = getFrameworkSDKPathWithFallbacks();

		let result =
		[
			//compile SWF or Royale JS
			this.getTask("compile debug build",
				workspaceRoot, command, frameworkSDK, true, null),
			this.getTask("compile release build",
				workspaceRoot, command, frameworkSDK, false, null),
		];

		if(isAIRMobile)
		{
			result.push(this.getTask("package debug iOS application",
				workspaceRoot, command, frameworkSDK, true, PLATFORM_IOS));
			result.push(this.getTask("package release iOS application",
				workspaceRoot, command, frameworkSDK, false, PLATFORM_IOS));
			result.push(this.getTask("package debug Android application",
				workspaceRoot, command, frameworkSDK, true, PLATFORM_ANDROID));
			result.push(this.getTask("package release Android application",
				workspaceRoot, command, frameworkSDK, false, PLATFORM_ANDROID));
		}
		if((isAIRDesktop && process.platform === "win32") || isBundleWindows)
		{
			result.push(this.getTask("package release Windows application (captive runtime)",
				workspaceRoot, command, frameworkSDK, false, PLATFORM_WINDOWS));
		}
		if((isAIRDesktop && process.platform === "darwin") || isBundleMac)
		{
			result.push(this.getTask("package release macOS application (captive runtime)",
				workspaceRoot, command, frameworkSDK, false, PLATFORM_MAC));
		}
		if(isAIRDesktop && (process.platform !== "win32" || !isBundleWindows) && (process.platform !== "darwin" || !isBundleMac))
		{
			//it's an AIR desktop application and the bundle target is not
			//specified explicitly
			result.push(this.getTask("package debug desktop application (shared runtime)",
				workspaceRoot, command, frameworkSDK, true, PLATFORM_AIR));
			result.push(this.getTask("package release desktop application (shared runtime)",
				workspaceRoot, command, frameworkSDK, false, PLATFORM_AIR));
		}

		return Promise.resolve(result);
	}

	resolveTask(task: vscode.Task): vscode.Task | undefined
	{
		console.error("resolve task", task);
		return undefined;
	}

	private getTask(description: string, workspaceFolder: vscode.WorkspaceFolder,
		command: string, sdk: string, debug: boolean, airPlatform: string): vscode.Task
	{
		let definition: ActionScriptTaskDefinition = { type: TASK_TYPE, debug: debug };
		if(airPlatform)
		{
			definition.air = airPlatform;
		}
		let options = ["--flexHome", sdk];
		if(debug)
		{
			options.push("--debug=true");
		}
		else
		{
			options.push("--debug=false");
		}
		if(airPlatform)
		{
			options.push("--air", airPlatform);
		}
		let source = airPlatform === null ? "ActionScript" : "Adobe AIR";
		let execution = new vscode.ProcessExecution(command, options);
		let task = new vscode.Task(definition, workspaceFolder, description,
			source, execution, MATCHER);
		task.group = vscode.TaskGroup.Build;
		return task;
	}

	private getCommand(): string
	{
		let nodeModulesBin = path.join(vscode.workspace.rootPath, "node_modules", ".bin");
		if(process.platform === "win32")
		{
			let executableName = "asconfigc.cmd";
			//start out by looking for asconfigc in the workspace's local Node modules
			let winPath = path.join(nodeModulesBin, executableName);
			if(fs.existsSync(winPath))
			{
				return winPath;
			}
			//otherwise, try to use a global executable
			return executableName;
		}
		let executableName = "asconfigc";
		let unixPath = path.join(nodeModulesBin, executableName);
		if(fs.existsSync(unixPath))
		{
			return unixPath;
		}
		return executableName;
	}
	
	private readASConfigJSON(filePath: string): string
	{
		try
		{
			let contents = fs.readFileSync(filePath, "utf8");
			return json5.parse(contents);
		}
		catch(error)
		{

		}
		return null;
	}

	private isAIRDesktop(asconfigJson: any): boolean
	{
		if(FIELD_APPLICATION in asconfigJson)
		{
			return true;
		}
		if(FIELD_AIR_OPTIONS in asconfigJson)
		{
			return true;
		}
		if(FIELD_CONFIG in asconfigJson)
		{
			let config = asconfigJson[FIELD_CONFIG];
			if(config === CONFIG_AIR)
			{
				return true;
			}
		}
		return false;
	}
	
	private isAIRMobile(asconfigJson: any): boolean
	{
		if(FIELD_CONFIG in asconfigJson)
		{
			let config = asconfigJson[FIELD_CONFIG];
			if(config === CONFIG_AIRMOBILE)
			{
				return true;
			}
		}
		return false;
	}
	
	private isBundleWindows(asconfigJson: any): boolean
	{
		if(process.platform !== "win32")
		{
			return false;
		}
		if(!(PLATFORM_WINDOWS in asconfigJson))
		{
			return false;
		}
		let windows = asconfigJson[PLATFORM_WINDOWS];
		if(!(FIELD_TARGET in windows))
		{
			return false;
		}
		let target = windows[FIELD_TARGET];
		return target === TARGET_BUNDLE;
	}
	
	private isBundleMac(asconfigJson: any): boolean
	{
		if(process.platform !== "darwin")
		{
			return false;
		}
		if(!(PLATFORM_MAC in asconfigJson))
		{
			return false;
		}
		let mac = asconfigJson[PLATFORM_MAC];
		if(!(FIELD_TARGET in mac))
		{
			return false;
		}
		let target = mac[FIELD_TARGET];
		return target === TARGET_BUNDLE;
	}
}