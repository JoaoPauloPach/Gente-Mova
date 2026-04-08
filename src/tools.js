import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockData = JSON.parse(
  readFileSync(join(__dirname, "../mock_data.json"), "utf-8")
);

// Contador de IDs para novos processos e posições
let processCounter = 4884;
let positionCounter = 50;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function calcPercentage(current, proposed) {
  return Math.round(((proposed - current) / current) * 1000) / 10;
}

function checkPolicyAlert(movementType, currentSalary, proposedSalary) {
  const policy = mockData.movement_policies.find(
    (p) => p.movement_type === movementType
  );
  if (!policy || policy.max_percentage === 0) return null;

  const pct = calcPercentage(currentSalary, proposedSalary);
  if (pct > policy.max_percentage) {
    return {
      rule: `Percentual de ${pct}% acima do limite de ${policy.max_percentage}% para ${policy.description}`,
      severity: policy.blocking ? "BLOCKING" : "WARNING",
      suggested_value: Math.round(
        currentSalary * (1 + policy.max_percentage / 100)
      ),
    };
  }
  return null;
}

// ─────────────────────────────────────────────
// Tool implementations
// ─────────────────────────────────────────────

function get_employees(input) {
  let results = [...mockData.employees];

  if (input.cost_center)
    results = results.filter((e) => e.cost_center === input.cost_center);

  if (input.role)
    results = results.filter(
      (e) =>
        e.role.toLowerCase().includes(input.role.toLowerCase()) ||
        e.role_code.toLowerCase() === input.role.toLowerCase()
    );

  if (input.department)
    results = results.filter((e) =>
      e.department.toLowerCase().includes(input.department.toLowerCase())
    );

  if (input.establishment)
    results = results.filter(
      (e) =>
        e.establishment.toLowerCase() === input.establishment.toLowerCase()
    );

  if (input.salary_lt)
    results = results.filter((e) => e.salary < input.salary_lt);

  if (input.salary_gt)
    results = results.filter((e) => e.salary > input.salary_gt);

  if (input.employee_ids && input.employee_ids.length > 0)
    results = results.filter((e) => input.employee_ids.includes(e.id));

  if (input.names && input.names.length > 0)
    results = results.filter((e) =>
      input.names.some((n) => e.name.toLowerCase().includes(n.toLowerCase()))
    );

  if (input.exclude_on_leave_gt_days != null)
    results = results.filter(
      (e) => e.on_leave_days <= input.exclude_on_leave_gt_days
    );

  const totalMonthlyCost = results.reduce((sum, e) => sum + e.salary, 0);

  return {
    total_found: results.length,
    employees: results.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      cost_center: e.cost_center,
      department: e.department,
      salary: e.salary,
      status: e.status,
      on_leave_days: e.on_leave_days,
      performance_score: e.performance_score,
      last_movement_date: e.last_movement_date,
    })),
    total_monthly_cost: totalMonthlyCost,
  };
}

function get_salary_table(input) {
  for (const table of mockData.salary_tables) {
    const level = table.levels.find(
      (l) =>
        l.role_code.toLowerCase() === input.role_code.toLowerCase() ||
        l.role.toLowerCase().includes(input.role_code.toLowerCase())
    );
    if (level) {
      return {
        table_id: table.id,
        career: table.career,
        role: level.role,
        role_code: level.role_code,
        band_min: level.band_min,
        band_mid: level.band_mid,
        band_max: level.band_max,
        all_levels: table.levels,
      };
    }
  }
  return { error: `Tabela salarial não encontrada para o cargo ${input.role_code}` };
}

function get_movement_policy(input) {
  const policy = mockData.movement_policies.find(
    (p) => p.movement_type === input.movement_type
  );
  if (!policy)
    return { error: `Política não encontrada para ${input.movement_type}` };
  return policy;
}

function check_position(input) {
  let positions = mockData.positions.filter(
    (p) =>
      p.role_code.toLowerCase() === input.role_code.toLowerCase() &&
      p.cost_center === input.cost_center
  );

  if (input.status_filter && input.status_filter !== "ANY")
    positions = positions.filter((p) => p.status === input.status_filter);

  const openPositions = positions.filter(
    (p) => p.status === "OPEN" && p.is_1to1
  );

  let recommendation = "CREATE_NEW";
  if (openPositions.length > 0) recommendation = "USE_EXISTING";
  else if (positions.length > 0) recommendation = "RESTRUCTURE";

  return {
    positions_found: positions.length,
    open_1to1_found: openPositions.length,
    positions,
    recommendation,
  };
}

function create_position(input) {
  const table = mockData.salary_tables.find(
    (t) =>
      t.levels.some((l) => l.role_code === input.role_code) &&
      (!input.salary_table_id || t.id === input.salary_table_id)
  );

  const newId = `POS-CC${input.cost_center}-00${positionCounter++}`;
  const newPosition = {
    id: newId,
    role_code: input.role_code,
    role: input.role_code,
    cost_center: input.cost_center,
    department: input.department,
    status: "OPEN",
    is_1to1: true,
    current_occupant_id: null,
    salary_table_id: table ? table.id : "TAB-TRAD-1",
    headcount_type: input.headcount_type || "STRUCTURAL",
  };

  mockData.positions.push(newPosition);

  return {
    success: true,
    new_position_id: newId,
    position_details: newPosition,
    message: `Posição ${newId} criada com sucesso no CC ${input.cost_center}.`,
  };
}

function submit_movement(input) {
  const employee = mockData.employees.find((e) => e.id === input.employee_id);
  if (!employee)
    return { success: false, status: "ERROR", message: `Colaborador ${input.employee_id} não encontrado.` };

  const processId = `WF-2025-0${processCounter++}`;
  const policyAlert =
    input.proposed_salary
      ? checkPolicyAlert(input.movement_type, employee.salary, input.proposed_salary)
      : null;

  const increasePercentage = input.proposed_salary
    ? calcPercentage(employee.salary, input.proposed_salary)
    : 0;

  const approverConfig = mockData.workflow_approvers.find(
    (a) => a.cost_center === (input.target_cost_center || employee.cost_center)
  );
  const nextApprover = approverConfig ? approverConfig.approvers[0] : null;

  // Registra no mock
  mockData.pending_movements.push({
    process_id: processId,
    employee_id: input.employee_id,
    employee_name: employee.name,
    movement_type: input.movement_type,
    current_salary: employee.salary,
    proposed_salary: input.proposed_salary || employee.salary,
    increase_percentage: increasePercentage,
    cost_center: input.target_cost_center || employee.cost_center,
    status: "PENDING_APPROVAL",
    approver_id: nextApprover ? nextApprover.user_id : "BP-0001",
    cycle: new Date().toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).toUpperCase(),
    policy_alert: !!policyAlert,
    policy_alert_message: policyAlert ? policyAlert.rule : null,
    effective_date: input.effective_date,
    submitted_by: "MOVA_AGENT",
    submitted_at: new Date().toISOString().split("T")[0],
  });

  return {
    success: true,
    process_id: processId,
    status: "PENDING_APPROVAL",
    employee_name: employee.name,
    current_salary: employee.salary,
    proposed_salary: input.proposed_salary,
    increase_percentage: increasePercentage,
    next_approver: nextApprover,
    salary_policy_alerts: policyAlert ? [policyAlert] : [],
    message: `Processo ${processId} criado para ${employee.name}. Aguardando aprovação de ${nextApprover ? nextApprover.name : "aprovador configurado"}.`,
  };
}

function list_pending_approvals(input) {
  let movements = [...mockData.pending_movements];

  if (input.approver_id)
    movements = movements.filter((m) => m.approver_id === input.approver_id);

  if (input.cost_center)
    movements = movements.filter((m) => m.cost_center === input.cost_center);

  if (input.cycle)
    movements = movements.filter((m) => m.cycle === input.cycle);

  if (input.status_filter && input.status_filter !== "ALL")
    movements = movements.filter((m) => m.status === input.status_filter);

  const clean = movements.filter((m) => m.status === "PENDING_APPROVAL" && !m.policy_alert);
  const withAlert = movements.filter((m) => m.status === "PENDING_APPROVAL" && m.policy_alert);
  const withError = movements.filter((m) => m.status === "ERROR");

  const deltaMonthly = movements
    .filter((m) => m.status === "PENDING_APPROVAL")
    .reduce((sum, m) => sum + ((m.proposed_salary || 0) - (m.current_salary || 0)), 0);

  return {
    total: movements.length,
    clean_count: clean.length,
    alert_count: withAlert.length,
    error_count: withError.length,
    approvable_count: clean.length + withAlert.length,
    consolidated_delta_monthly: deltaMonthly,
    consolidated_delta_annual: deltaMonthly * 12,
    movements: movements.map((m) => ({
      process_id: m.process_id,
      employee_name: m.employee_name,
      movement_type: m.movement_type,
      current_salary: m.current_salary,
      proposed_salary: m.proposed_salary,
      increase_percentage: m.increase_percentage,
      status: m.status,
      policy_alert: m.policy_alert,
      policy_alert_message: m.policy_alert_message,
      error_message: m.error_message,
      effective_date: m.effective_date,
    })),
  };
}

function approve_movement(input) {
  const movement = mockData.pending_movements.find(
    (m) => m.process_id === input.process_id
  );

  if (!movement)
    return { success: false, message: `Processo ${input.process_id} não encontrado.` };

  if (movement.status === "ERROR")
    return { success: false, message: `Processo ${input.process_id} possui erros e não pode ser aprovado.` };

  movement.status = "APPROVED";
  movement.approved_by = input.approver_id;
  movement.approved_at = new Date().toISOString().split("T")[0];
  movement.comment = input.comment;

  return {
    success: true,
    process_id: input.process_id,
    employee_name: movement.employee_name,
    new_status: "APPROVED",
    message: `Processo ${input.process_id} aprovado para ${movement.employee_name}.`,
  };
}

function reject_movement(input) {
  const movement = mockData.pending_movements.find(
    (m) => m.process_id === input.process_id
  );

  if (!movement)
    return { success: false, message: `Processo ${input.process_id} não encontrado.` };

  movement.status = "RETURNED";
  movement.rejected_by = input.approver_id;
  movement.rejection_reason = input.reason;
  movement.rejected_at = new Date().toISOString().split("T")[0];

  return {
    success: true,
    process_id: input.process_id,
    employee_name: movement.employee_name,
    new_status: "RETURNED",
    message: `Processo ${input.process_id} devolvido para ${movement.employee_name}. Motivo: ${input.reason}. Solicitante será notificado.`,
  };
}

function open_vacancy(input) {
  const position = mockData.positions.find(
    (p) => p.id === input.original_position_id
  );
  if (!position)
    return { success: false, message: `Posição ${input.original_position_id} não encontrada.` };

  position.status = "OPEN";
  position.current_occupant_id = null;

  return {
    success: true,
    position_id: input.original_position_id,
    role: position.role,
    cost_center: position.cost_center,
    vacancy_status: "OPEN",
    message: `Vaga aberta na posição ${input.original_position_id} (${position.role}, CC ${position.cost_center}). Disponível para recrutamento.`,
  };
}

// ─────────────────────────────────────────────
// Tool dispatcher
// ─────────────────────────────────────────────

const TOOL_MAP = {
  get_employees,
  get_salary_table,
  get_movement_policy,
  check_position,
  create_position,
  submit_movement,
  list_pending_approvals,
  approve_movement,
  reject_movement,
  open_vacancy,
};

export async function executeTool(toolName, input) {
  const fn = TOOL_MAP[toolName];
  if (!fn) return { error: `Tool desconhecida: ${toolName}` };
  return fn(input);
}

// ─────────────────────────────────────────────
// Tool definitions para a API Anthropic
// ─────────────────────────────────────────────

export function getToolDefinitions() {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, "../manifest.json"), "utf-8")
  );
  return manifest.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}
