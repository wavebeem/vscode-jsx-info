import * as vscode from "vscode";

export function activate(_context: vscode.ExtensionContext) {
  // Samples of `window.registerTreeDataProvider`
  const nodeDependenciesProvider = new DepNodeProvider();
  vscode.window.registerTreeDataProvider(
    "nodeDependencies",
    nodeDependenciesProvider
  );
  vscode.commands.registerCommand("nodeDependencies.refreshEntry", () =>
    nodeDependenciesProvider.refresh()
  );
  vscode.commands.registerCommand("extension.openPackageOnNpm", (moduleName) =>
    vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.parse(`https://www.npmjs.com/package/${moduleName}`)
    )
  );
  vscode.commands.registerCommand("nodeDependencies.addEntry", () =>
    vscode.window.showInformationMessage(`Successfully called add entry.`)
  );
}

class DepNodeProvider implements vscode.TreeDataProvider<Dependency> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    Dependency | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Dependency): vscode.TreeItem {
    return element;
  }

  async getChildren(_element?: Dependency): Promise<Dependency[]> {
    if (vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showInformationMessage(
        "Can't use jsx-info in an empty workspace"
      );
      return [];
    }
    return [new Dependency("Test")];
  }
}

class Dependency extends vscode.TreeItem {
  constructor(label: string) {
    super(label);
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.contextValue = "dependency";
    this.command = undefined;
    this.tooltip = "$tooltip";
    this.description = "$description";
  }
}
