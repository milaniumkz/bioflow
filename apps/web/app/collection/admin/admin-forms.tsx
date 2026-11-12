"use client";
import { useState, type ReactNode } from "react";
import { kgAsTonnes } from "../weight-units";
import {
  roleLabels,
  stateLabels,
  stockKg,
  tonnesInput,
  type Row,
} from "./admin-types";
export function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <label className="ca-field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
export function Reason({
  value = "",
  label = "Комментарий",
  minLength = 3,
}: {
  value?: string;
  label?: string;
  minLength?: number;
}) {
  return (
    <Field label={label}>
      <textarea
        aria-label={label}
        name="reason"
        minLength={minLength}
        maxLength={500}
        required
        defaultValue={value}
        rows={2}
      />
    </Field>
  );
}
export function Weight({
  label = "Вес, тонн",
  name = "weight",
  value = "",
  allowZero = false,
}: {
  label?: string;
  name?: string;
  value?: string;
  allowZero?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        aria-label={label}
        name={name}
        inputMode="decimal"
        pattern="[0-9]+([.,][0-9]{1,6})?"
        required
        defaultValue={value}
        placeholder={allowZero ? "0" : "Например, 20"}
      />
    </Field>
  );
}
export function SiteSelect({
  data,
  kind,
  label = "Объект",
  name = "locationId",
  initial = "",
  includeInactive = false,
  onChange,
}: {
  data: Row;
  kind?: string;
  label?: string;
  name?: string;
  initial?: string;
  includeInactive?: boolean;
  onChange?(id: string): void;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        name={name}
        defaultValue={initial}
        required
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="">Выберите объект</option>
        {data.locations
          .filter(
            (l: Row) =>
              (l.active || includeInactive) && (!kind || l.kind === kind),
          )
          .map((l: Row) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {!l.active ? " · архив" : ""}
              {!kind ? (l.kind === "FACTORY" ? " · завод" : " · мойка") : ""}
            </option>
          ))}
      </select>
    </Field>
  );
}
export function UserForm({
  data,
  user,
  owner,
}: {
  data: Row;
  user?: Row;
  owner: boolean;
}) {
  const [role, setRole] = useState(
    user?.userRoles?.[0]?.role.code ?? "COLLECTOR",
  );
  const [assigned, setAssigned] = useState<string[]>(
    data.memberships
      .filter((m: Row) => m.userId === user?.id)
      .map((m: Row) => m.locationId),
  );
  const kind =
    role === "WAREHOUSE_MANAGER"
      ? "WAREHOUSE"
      : role === "FACTORY_MANAGER"
        ? "FACTORY"
        : "";
  return (
    <>
      <div className="ca-form-grid">
        <Field label="ФИО">
          <input
            aria-label="ФИО"
            name="fullName"
            autoComplete="off"
            defaultValue={user?.fullName ?? ""}
            minLength={2}
            maxLength={120}
            required
          />
        </Field>
        <Field label="Номер телефона">
          <input
            aria-label="Номер телефона"
            name="phone"
            type="tel"
            defaultValue={user?.phone ?? ""}
            autoComplete="off"
            required
          />
        </Field>
      </div>
      <Field label="Роль">
        <select
          aria-label="Роль"
          name="role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setAssigned([]);
          }}
        >
          {Object.entries(roleLabels)
            .filter(([code]) => owner || code !== "OWNER")
            .map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
        </select>
      </Field>
      {kind && (
        <fieldset className="ca-checks">
          <legend>Доступ к объектам</legend>
          {data.locations
            .filter((l: Row) => l.kind === kind)
            .map((l: Row) => (
              <label key={l.id}>
                <input
                  type="checkbox"
                  name="locationIds"
                  value={l.id}
                  checked={assigned.includes(l.id)}
                  onChange={(e) =>
                    setAssigned(
                      e.target.checked
                        ? [...assigned, l.id]
                        : assigned.filter((id) => id !== l.id),
                    )
                  }
                />
                {l.name}
              </label>
            ))}
          <small>Можно назначить несколько объектов.</small>
        </fieldset>
      )}
      {!user && (
        <Field label="Пароль">
          <input
            aria-label="Пароль"
            name="password"
            type="password"
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
            required
          />
          <small>От 6 символов. Обязательной смены при входе нет.</small>
        </Field>
      )}
      <Reason
        value={user ? "Изменение пользователя" : "Создание пользователя"}
      />
    </>
  );
}
export function LocationForm({ location }: { location?: Row }) {
  return (
    <>
      <Field label="Название">
        <input
          aria-label="Название"
          name="name"
          defaultValue={location?.name ?? ""}
          minLength={2}
          maxLength={100}
          required
        />
      </Field>
      <Field label="Тип объекта">
        <select
          aria-label="Тип объекта"
          name="kind"
          defaultValue={location?.kind ?? "WAREHOUSE"}
          disabled={!!location}
        >
          <option value="WAREHOUSE">Мойка / склад</option>
          <option value="FACTORY">Завод</option>
        </select>
        {location && <input type="hidden" name="kind" value={location.kind} />}
      </Field>
      <label className="ca-check-line">
        <input
          type="checkbox"
          name="active"
          defaultChecked={location ? location.active : true}
        />
        Объект активен
      </label>
      <Reason value={location ? "Изменение объекта" : "Создание объекта"} />
    </>
  );
}
export function StockForm({
  data,
  initialLocation = "",
  initialState = "RAW",
}: {
  data: Row;
  initialLocation?: string;
  initialState?: string;
}) {
  const [locationId, setLocation] = useState(initialLocation);
  const [state, setState] = useState(initialState);
  const [target, setTarget] = useState(
    tonnesInput(stockKg(data, initialLocation, initialState)),
  );
  const current = stockKg(data, locationId, state);
  const factory =
    data.locations.find((l: Row) => l.id === locationId)?.kind === "FACTORY";
  return (
    <>
      <SiteSelect
        data={data}
        includeInactive
        initial={initialLocation}
        onChange={(id) => {
          setLocation(id);
          const s =
            data.locations.find((l: Row) => l.id === id)?.kind === "FACTORY"
              ? "WASHED"
              : state;
          setState(s);
          setTarget(tonnesInput(stockKg(data, id, s)));
        }}
      />
      <Field label="Вид сырья">
        <select
          aria-label="Вид сырья"
          name="state"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setTarget(tonnesInput(stockKg(data, locationId, e.target.value)));
          }}
        >
          {(!factory ? ["RAW", "WASHED"] : ["WASHED"]).map((s) => (
            <option key={s} value={s}>
              {stateLabels[s]}
            </option>
          ))}
        </select>
      </Field>
      <div className="ca-inline-stat">
        Сейчас на остатке <strong>{kgAsTonnes(current)} т</strong>
      </div>
      <Field label="Фактический остаток, тонн">
        <input
          aria-label="Фактический остаток, тонн"
          name="target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          inputMode="decimal"
          pattern="[0-9]+([.,][0-9]{1,6})?"
          required
        />
      </Field>
      <input type="hidden" name="expectedKg" value={current} />
      <small>
        Корректировка сохранится отдельной операцией. Исходные приходы и
        начальные остатки останутся в истории.
      </small>
      <Reason label="Причина корректировки" />
    </>
  );
}
export function BagWeights({
  name,
  title,
  presets = false,
  initialCount = "1",
}: {
  name: string;
  title: string;
  presets?: boolean;
  initialCount?: string;
}) {
  const [count, setCount] = useState(initialCount);
  const number = /^\d+$/.test(count) ? Math.min(1000, Number(count)) : 0;
  return (
    <fieldset className="ca-bag-fieldset">
      <legend>{title}</legend>
      <Field label={`Количество бигбегов · ${title}`}>
        <input
          aria-label={`Количество бигбегов · ${title}`}
          name={name + "Count"}
          type="number"
          min={0}
          max={1000}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          required
        />
      </Field>
      <div className="ca-bag-inputs">
        {Array.from({ length: number }, (_, i) => (
          <Field label={`Бигбег ${i + 1}, тонн · ${title}`} key={i}>
            {presets ? (
              <select
                aria-label={`Бигбег ${i + 1}, тонн · ${title}`}
                name={name}
                defaultValue="0.8"
              >
                <option value="0.8">0,8 т — 800 кг</option>
                <option value="0.825">0,825 т — 825 кг</option>
              </select>
            ) : (
              <input
                aria-label={`Бигбег ${i + 1}, тонн · ${title}`}
                name={name}
                inputMode="decimal"
                pattern="[0-9]+([.,][0-9]{1,6})?"
                required
              />
            )}
          </Field>
        ))}
      </div>
    </fieldset>
  );
}
export function ProductionForm({ data }: { data: Row }) {
  return (
    <>
      <SiteSelect data={data} kind="FACTORY" label="Завод" />
      <BagWeights name="finished" title="Готовая продукция" presets />
      <BagWeights name="rejected" title="Некондиция" initialCount="0" />
    </>
  );
}
export function AddBagsForm({ data }: { data: Row }) {
  const [state, setState] = useState("FINISHED");
  return (
    <>
      <SiteSelect data={data} kind="FACTORY" label="Завод" />
      <Field label="Вид продукции">
        <select
          aria-label="Вид продукции"
          name="state"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="FINISHED">Готовая продукция</option>
          <option value="REJECT">Некондиция</option>
        </select>
      </Field>
      <BagWeights
        key={state}
        name="weights"
        title={stateLabels[state]}
        presets={state === "FINISHED"}
      />
      <Reason label="Причина корректировки" />
    </>
  );
}
export function GpForm({ data }: { data: Row }) {
  const [site, setSite] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const bags = data.batches
    .filter(
      (b: Row) =>
        b.locationId === site &&
        b.state === "FINISHED" &&
        b.status === "ACTIVE",
    )
    .flatMap((b: Row) =>
      b.bags
        .filter((bag: Row) => bag.status === "AVAILABLE")
        .map((bag: Row) => ({ ...bag, batchDate: b.createdAt })),
    );
  return (
    <>
      <SiteSelect
        data={data}
        kind="FACTORY"
        label="Завод"
        onChange={(id) => {
          setSite(id);
          setSelected([]);
        }}
      />
      <Field label="Получатель">
        <input
          aria-label="Получатель"
          name="recipientName"
          minLength={2}
          maxLength={120}
          required
        />
      </Field>
      <Field label="Адрес доставки">
        <input
          aria-label="Адрес доставки"
          name="recipientAddress"
          minLength={3}
          maxLength={300}
          required
        />
      </Field>
      <fieldset className="ca-checks">
        <legend>Бигбеги к отправке</legend>
        {bags.length ? (
          bags.map((bag: Row) => (
            <label key={bag.id}>
              <input
                name="bagIds"
                type="checkbox"
                value={bag.id}
                checked={selected.includes(bag.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, bag.id]
                      : selected.filter((id) => id !== bag.id),
                  )
                }
              />
              Бигбег {bag.index} · {kgAsTonnes(bag.weightKg)} т ·{" "}
              {new Date(bag.batchDate).toLocaleDateString("ru-RU")}
            </label>
          ))
        ) : (
          <p className="ca-muted">
            Выберите завод с доступной готовой продукцией.
          </p>
        )}
      </fieldset>
      <p>
        Выбрано: {selected.length} ·{" "}
        {kgAsTonnes(
          bags
            .filter((b: Row) => selected.includes(b.id))
            .reduce((sum: number, b: Row) => sum + Number(b.weightKg), 0),
        )}{" "}
        т
      </p>
    </>
  );
}
export function OperationForm({ data, kind }: { data: Row; kind: string }) {
  const [weight, setWeight] = useState("");
  const [count, setCount] = useState("");
  return (
    <>
      {kind === "shipment" ? (
        <>
          <SiteSelect data={data} kind="WAREHOUSE" label="Со склада" />
          <SiteSelect
            data={data}
            kind="FACTORY"
            label="На завод"
            name="factoryId"
          />
        </>
      ) : (
        <SiteSelect
          data={data}
          kind="WAREHOUSE"
          label={kind === "trip" ? "Склад назначения" : "Мойка"}
        />
      )}
      {kind !== "wash" && (
        <Field
          label={kind === "trip" ? "Количество мешков" : "Количество бигбегов"}
        >
          <input
            aria-label={
              kind === "trip" ? "Количество мешков" : "Количество бигбегов"
            }
            name="bagCount"
            type="number"
            min={1}
            max={100000}
            required
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </Field>
      )}
      <Field label="Общий вес, тонн">
        <input
          aria-label="Общий вес, тонн"
          name="weight"
          inputMode="decimal"
          pattern="[0-9]+([.,][0-9]{1,6})?"
          required
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </Field>
      {kind === "shipment" && Number(count) > 0 && (
        <small>
          Средний вес бигбега:{" "}
          {(Number(weight.replace(",", ".")) / Number(count)).toLocaleString(
            "ru-RU",
            { maximumFractionDigits: 6 },
          )}{" "}
          т.
        </small>
      )}
    </>
  );
}
export function TripForm({ trip, data }: { trip: Row; data: Row }) {
  return (
    <>
      {trip.kind === "RAW" ? (
        <>
          <Field label="Количество мешков">
            <input
              aria-label="Количество мешков"
              name="bagCount"
              type="number"
              min={1}
              max={100000}
              required
              defaultValue={trip.bagCount}
            />
          </Field>
          {trip.status === "CREATED" && !trip.driver && (
            <SiteSelect
              data={data}
              kind="WAREHOUSE"
              name="warehouseId"
              label="Склад назначения"
              initial={trip.warehouseId}
            />
          )}
        </>
      ) : (
        <>
          <Field label="Получатель">
            <input
              aria-label="Получатель"
              name="recipientName"
              minLength={2}
              maxLength={120}
              defaultValue={trip.recipientName}
              required
            />
          </Field>
          <Field label="Адрес доставки">
            <input
              aria-label="Адрес доставки"
              name="recipientAddress"
              minLength={3}
              maxLength={300}
              defaultValue={trip.recipientAddress}
              required
            />
          </Field>
        </>
      )}
      {trip.driver && (
        <>
          <Field label="Госномер">
            <input
              aria-label="Госномер"
              name="driverPlate"
              minLength={2}
              maxLength={30}
              defaultValue={trip.driver.driverPlate}
              required
            />
          </Field>
          <Field label="Телефон водителя">
            <input
              aria-label="Телефон водителя"
              name="driverPhone"
              type="tel"
              defaultValue={trip.driver.driverPhone}
              required
            />
          </Field>
        </>
      )}
      <Reason value="Исправление реквизитов рейса" />
    </>
  );
}
