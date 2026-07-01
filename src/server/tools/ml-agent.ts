/**
 * ML/AI Pipeline Agent — Dataset preprocessing, feature engineering, model training,
 * hyperparameter tuning, graph generation, evaluation reports, visualization,
 * auto chart generation, KPI dashboards, confusion matrix, PDF/Excel report export
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

const execAsync = promisify(exec);

// ── Generate Python ML script ─────────────────────────────────────────────────
function generateMLScript(task: string, dataPath: string, outputDir: string, params: Record<string, any>): string {
  const scripts: Record<string, string> = {
    preprocess: `
import pandas as pd
import numpy as np
import json
import os

data_path = r"${dataPath}"
output_dir = r"${outputDir}"
os.makedirs(output_dir, exist_ok=True)

# Load data
if data_path.endswith('.csv'):
    df = pd.read_csv(data_path)
elif data_path.endswith('.json'):
    df = pd.read_json(data_path)
elif data_path.endswith('.xlsx') or data_path.endswith('.xls'):
    df = pd.read_excel(data_path)
else:
    df = pd.read_csv(data_path)

print(f"Loaded: {df.shape[0]} rows, {df.shape[1]} columns")
print(f"Columns: {list(df.columns)}")
print(f"\\nMissing values:\\n{df.isnull().sum()}")
print(f"\\nData types:\\n{df.dtypes}")
print(f"\\nBasic stats:\\n{df.describe()}")

# Handle missing values
df_clean = df.dropna()
print(f"\\nAfter cleaning: {df_clean.shape[0]} rows")

# Save cleaned data
out_path = os.path.join(output_dir, "cleaned_data.csv")
df_clean.to_csv(out_path, index=False)
print(f"\\nCleaned data saved to: {out_path}")
`,
    visualize: `
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np
import os

data_path = r"${dataPath}"
output_dir = r"${outputDir}"
os.makedirs(output_dir, exist_ok=True)

# Load data
try:
    df = pd.read_csv(data_path)
except:
    df = pd.read_json(data_path)

numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
print(f"Numeric columns: {numeric_cols}")

# Create dashboard
fig = plt.figure(figsize=(16, 12))
fig.suptitle('Data Dashboard', fontsize=16, fontweight='bold')

n_plots = min(len(numeric_cols), 6)
if n_plots == 0:
    print("No numeric columns found for visualization")
else:
    gs = gridspec.GridSpec(2, 3, figure=fig)
    for i, col in enumerate(numeric_cols[:n_plots]):
        ax = fig.add_subplot(gs[i // 3, i % 3])
        df[col].hist(ax=ax, bins=20, color='steelblue', edgecolor='white', alpha=0.8)
        ax.set_title(col, fontsize=10)
        ax.set_xlabel('Value')
        ax.set_ylabel('Frequency')

plt.tight_layout()
out_path = os.path.join(output_dir, "dashboard.png")
plt.savefig(out_path, dpi=150, bbox_inches='tight')
plt.close()
print(f"Dashboard saved to: {out_path}")

# Correlation heatmap
if len(numeric_cols) > 1:
    fig2, ax2 = plt.subplots(figsize=(10, 8))
    corr = df[numeric_cols].corr()
    im = ax2.imshow(corr, cmap='coolwarm', aspect='auto', vmin=-1, vmax=1)
    plt.colorbar(im, ax=ax2)
    ax2.set_xticks(range(len(numeric_cols)))
    ax2.set_yticks(range(len(numeric_cols)))
    ax2.set_xticklabels(numeric_cols, rotation=45, ha='right')
    ax2.set_yticklabels(numeric_cols)
    ax2.set_title('Correlation Heatmap')
    for i in range(len(numeric_cols)):
        for j in range(len(numeric_cols)):
            ax2.text(j, i, f'{corr.iloc[i, j]:.2f}', ha='center', va='center', fontsize=8)
    plt.tight_layout()
    corr_path = os.path.join(output_dir, "correlation_heatmap.png")
    plt.savefig(corr_path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Correlation heatmap saved to: {corr_path}")
`,
    train_classifier: `
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json
import os

data_path = r"${dataPath}"
target_col = "${params.target_column || 'target'}"
output_dir = r"${outputDir}"
os.makedirs(output_dir, exist_ok=True)

# Load data
df = pd.read_csv(data_path)
print(f"Dataset: {df.shape}")

if target_col not in df.columns:
    target_col = df.columns[-1]
    print(f"Using last column as target: {target_col}")

X = df.drop(columns=[target_col])
y = df[target_col]

# Encode categoricals
le = LabelEncoder()
for col in X.select_dtypes(include=['object']).columns:
    X[col] = le.fit_transform(X[col].astype(str))
if y.dtype == 'object':
    y = le.fit_transform(y.astype(str))

X = X.fillna(X.mean())
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

scaler = StandardScaler()
X_train_s = scaler.fit_transform(X_train)
X_test_s = scaler.transform(X_test)

# Train multiple models
models = {
    'Random Forest': RandomForestClassifier(n_estimators=100, random_state=42),
    'Gradient Boosting': GradientBoostingClassifier(random_state=42),
    'Logistic Regression': LogisticRegression(max_iter=1000, random_state=42),
}

results = {}
best_model = None
best_acc = 0

for name, model in models.items():
    model.fit(X_train_s, y_train)
    y_pred = model.predict(X_test_s)
    acc = accuracy_score(y_test, y_pred)
    cv_scores = cross_val_score(model, X_train_s, y_train, cv=5)
    results[name] = {'accuracy': acc, 'cv_mean': cv_scores.mean(), 'cv_std': cv_scores.std()}
    print(f"{name}: Accuracy={acc:.4f}, CV={cv_scores.mean():.4f}±{cv_scores.std():.4f}")
    if acc > best_acc:
        best_acc = acc
        best_model = (name, model, y_pred)

# Confusion matrix for best model
if best_model:
    name, model, y_pred = best_model
    cm = confusion_matrix(y_test, y_pred)
    fig, ax = plt.subplots(figsize=(8, 6))
    im = ax.imshow(cm, interpolation='nearest', cmap='Blues')
    plt.colorbar(im, ax=ax)
    ax.set_title(f'Confusion Matrix - {name}')
    ax.set_xlabel('Predicted')
    ax.set_ylabel('Actual')
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(cm[i, j]), ha='center', va='center', fontsize=12)
    plt.tight_layout()
    cm_path = os.path.join(output_dir, "confusion_matrix.png")
    plt.savefig(cm_path, dpi=150)
    plt.close()
    print(f"Confusion matrix saved to: {cm_path}")
    print(f"\\nBest model: {name} (Accuracy: {best_acc:.4f})")
    print(f"\\nClassification Report:\\n{classification_report(y_test, y_pred)}")

# Save results
results_path = os.path.join(output_dir, "model_results.json")
with open(results_path, 'w') as f:
    json.dump(results, f, indent=2)
print(f"Results saved to: {results_path}")
`,
    generate_report: `
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.backends.backend_pdf as pdf_backend
import os
import json
from datetime import datetime

data_path = r"${dataPath}"
output_dir = r"${outputDir}"
os.makedirs(output_dir, exist_ok=True)

# Load data
df = pd.read_csv(data_path)
numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()

# Create PDF report
report_path = os.path.join(output_dir, f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf")
with pdf_backend.PdfPages(report_path) as pdf:
    # Page 1: Overview
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    fig.suptitle('Data Analysis Report', fontsize=16, fontweight='bold')
    
    # Dataset info
    axes[0, 0].axis('off')
    info_text = f"Dataset Overview\\n\\nRows: {df.shape[0]}\\nColumns: {df.shape[1]}\\nNumeric cols: {len(numeric_cols)}\\nMissing values: {df.isnull().sum().sum()}\\nGenerated: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    axes[0, 0].text(0.1, 0.5, info_text, transform=axes[0, 0].transAxes, fontsize=11, verticalalignment='center', fontfamily='monospace', bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.5))
    
    if len(numeric_cols) >= 1:
        df[numeric_cols[0]].hist(ax=axes[0, 1], bins=20, color='steelblue', edgecolor='white')
        axes[0, 1].set_title(f'Distribution: {numeric_cols[0]}')
    
    if len(numeric_cols) >= 2:
        axes[1, 0].scatter(df[numeric_cols[0]], df[numeric_cols[1]], alpha=0.5, color='coral')
        axes[1, 0].set_xlabel(numeric_cols[0])
        axes[1, 0].set_ylabel(numeric_cols[1])
        axes[1, 0].set_title('Scatter Plot')
    
    if len(numeric_cols) >= 1:
        df[numeric_cols[:min(5, len(numeric_cols))]].boxplot(ax=axes[1, 1])
        axes[1, 1].set_title('Box Plots')
        axes[1, 1].tick_params(axis='x', rotation=45)
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close()

print(f"PDF report saved to: {report_path}")
`,
  };

  return scripts[task] || scripts.preprocess;
}

export const mlToolDeclarations: FunctionDeclaration[] = [
  {
    name: "ml_pipeline",
    description:
      "Runs ML/AI pipeline tasks: data preprocessing, visualization, model training, evaluation. Use when user says 'data analyze karo', 'model train karo', 'ML pipeline chalao', 'dataset preprocess karo', 'chart banao', 'visualization chahiye'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        task: {
          type: Type.STRING,
          description: "ML task to perform.",
          enum: ["preprocess", "visualize", "train_classifier", "generate_report"],
        },
        data_path: {
          type: Type.STRING,
          description: "Path to the dataset file (CSV, JSON, Excel).",
        },
        output_dir: {
          type: Type.STRING,
          description: "Directory to save outputs. Defaults to Desktop/ml_output.",
        },
        target_column: {
          type: Type.STRING,
          description: "For classification: the target/label column name.",
        },
      },
      required: ["task", "data_path"],
    },
  },
  {
    name: "generate_chart",
    description:
      "Generates a chart/graph from data or description. Use when user says 'chart banao', 'graph chahiye', 'plot karo', 'bar chart', 'pie chart', 'line graph'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        chart_type: {
          type: Type.STRING,
          description: "Type of chart.",
          enum: ["bar", "line", "pie", "scatter", "histogram", "heatmap", "box"],
        },
        data_json: {
          type: Type.STRING,
          description: "JSON string of data: {labels: [...], values: [...]} or {x: [...], y: [...]}.",
        },
        title: {
          type: Type.STRING,
          description: "Chart title.",
        },
        x_label: {
          type: Type.STRING,
          description: "X-axis label.",
        },
        y_label: {
          type: Type.STRING,
          description: "Y-axis label.",
        },
        save_path: {
          type: Type.STRING,
          description: "Where to save the chart. Defaults to Desktop.",
        },
      },
      required: ["chart_type", "data_json", "title"],
    },
  },
  {
    name: "install_ml_deps",
    description:
      "Installs required ML/data science Python packages. Use when user wants to run ML tasks but packages are missing.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        packages: {
          type: Type.STRING,
          description: "Comma-separated packages to install. Default: 'pandas,numpy,scikit-learn,matplotlib,seaborn'.",
        },
      },
      required: [],
    },
  },
];

export const handleMLAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;

  try {
    if (fc.name === "ml_pipeline") {
      const task = args.task;
      const dataPath = args.data_path;
      const outputDir = args.output_dir || path.join(os.homedir(), "Desktop", "ml_output");

      if (!fs.existsSync(dataPath)) {
        resultStr = `Error: Data file not found: ${dataPath}`;
        return { id: fc.id, name: fc.name, response: { result: resultStr } };
      }

      io.emit("system_status", `[ML] Running ${task} on ${path.basename(dataPath)}...`);
      logActivity("ML_PIPELINE", { task, dataPath });

      const params = { target_column: args.target_column || "target" };
      const script = generateMLScript(task, dataPath, outputDir, params);
      const tmpFile = path.join(os.tmpdir(), `og_ml_${Date.now()}.py`);
      fs.writeFileSync(tmpFile, script, "utf-8");

      try {
        const { stdout, stderr } = await execAsync(`python "${tmpFile}"`, {
          timeout: 120000,
          maxBuffer: 1024 * 1024,
        });
        resultStr = (stdout || "").trim() || (stderr || "").trim() || "ML task completed.";
        io.emit("system_status", `[ML] ${task} complete`);
      } catch (err: any) {
        if (err.message.includes("ModuleNotFoundError") || err.message.includes("No module named")) {
          resultStr = `Missing Python packages. Run: pip install pandas numpy scikit-learn matplotlib seaborn\n\nError: ${err.message.slice(0, 200)}`;
          io.emit("system_status", `[ML] Missing packages — run install_ml_deps`);
        } else {
          resultStr = `ML error: ${err.message.slice(0, 500)}`;
          io.emit("system_status", `[ML ERROR] ${err.message?.slice(0, 80)}`);
        }
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }

    } else if (fc.name === "generate_chart") {
      const chartType = args.chart_type;
      const title = args.title || "Chart";
      const savePath = args.save_path || path.join(os.homedir(), "Desktop", `chart_${Date.now()}.png`);

      io.emit("system_status", `[ML] Generating ${chartType} chart: ${title}`);
      logActivity("GENERATE_CHART", { chartType, title });

      let data: any;
      try {
        data = JSON.parse(args.data_json);
      } catch {
        resultStr = "Error: data_json must be valid JSON. Example: {\"labels\": [\"A\",\"B\"], \"values\": [10, 20]}";
        return { id: fc.id, name: fc.name, response: { result: resultStr } };
      }

      const savePathEscaped = savePath.replace(/\\/g, "\\\\");
      const dataStr = JSON.stringify(data).replace(/'/g, "\\'");

      const script = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import json

data = json.loads('${dataStr.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')
chart_type = "${chartType}"
title = "${title.replace(/"/g, "'")}"
x_label = "${(args.x_label || "").replace(/"/g, "'")}"
y_label = "${(args.y_label || "").replace(/"/g, "'")}"
save_path = "${savePathEscaped}"

fig, ax = plt.subplots(figsize=(10, 6))
ax.set_title(title, fontsize=14, fontweight='bold')
if x_label: ax.set_xlabel(x_label)
if y_label: ax.set_ylabel(y_label)

labels = data.get('labels', data.get('x', list(range(len(data.get('values', data.get('y', [])))))))
values = data.get('values', data.get('y', []))

if chart_type == 'bar':
    bars = ax.bar(labels, values, color='steelblue', edgecolor='white', linewidth=0.5)
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2., bar.get_height(), f'{val}', ha='center', va='bottom', fontsize=9)
elif chart_type == 'line':
    ax.plot(labels, values, marker='o', color='steelblue', linewidth=2, markersize=6)
    ax.fill_between(range(len(labels)), values, alpha=0.1, color='steelblue')
elif chart_type == 'pie':
    ax.pie(values, labels=labels, autopct='%1.1f%%', startangle=90, colors=plt.cm.Set3.colors)
    ax.axis('equal')
elif chart_type == 'scatter':
    x_vals = data.get('x', labels)
    y_vals = data.get('y', values)
    ax.scatter(x_vals, y_vals, color='coral', alpha=0.7, s=60)
elif chart_type == 'histogram':
    ax.hist(values, bins=20, color='steelblue', edgecolor='white', alpha=0.8)
elif chart_type == 'box':
    ax.boxplot(values if isinstance(values[0], list) else [values], labels=labels if isinstance(values[0], list) else ['Data'])
else:
    ax.bar(labels, values, color='steelblue')

ax.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig(save_path, dpi=150, bbox_inches='tight')
plt.close()
print(f"Chart saved to: {save_path}")
`;

      const tmpFile = path.join(os.tmpdir(), `og_chart_${Date.now()}.py`);
      fs.writeFileSync(tmpFile, script, "utf-8");

      try {
        const { stdout, stderr } = await execAsync(`python "${tmpFile}"`, { timeout: 30000 });
        resultStr = (stdout || "").trim() || `Chart saved to: ${savePath}`;
        io.emit("system_status", `[ML] Chart generated: ${title}`);
      } catch (err: any) {
        if (err.message.includes("ModuleNotFoundError")) {
          resultStr = `Missing matplotlib. Install with: pip install matplotlib`;
        } else {
          resultStr = `Chart error: ${err.message.slice(0, 300)}`;
        }
        io.emit("system_status", `[ML ERROR] Chart generation failed`);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }

    } else if (fc.name === "install_ml_deps") {
      const packages = args.packages || "pandas,numpy,scikit-learn,matplotlib,seaborn,openpyxl";
      const pkgList = packages.split(",").map((p: string) => p.trim()).join(" ");

      io.emit("system_status", `[ML] Installing: ${pkgList}`);
      logActivity("INSTALL_ML_DEPS", { packages: pkgList });

      try {
        const { stdout, stderr } = await execAsync(`pip install ${pkgList}`, {
          timeout: 120000,
          maxBuffer: 1024 * 1024,
        });
        resultStr = `Installed: ${pkgList}\n${(stdout || "").trim().slice(0, 500)}`;
        io.emit("system_status", `[ML] Packages installed`);
      } catch (err: any) {
        resultStr = `Install error: ${err.message.slice(0, 300)}`;
        io.emit("system_status", `[ML ERROR] Install failed`);
      }
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    io.emit("system_status", `[ML ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
