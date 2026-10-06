import { Col, Row, Tabs, Space, Table, Tag, Empty, Button, Select } from 'antd';
import React, { useEffect, useState, useContext, useMemo } from "react";
import { atom, useAtom } from "jotai";

import VirtualTable from "../../Library/VirtualTable";
import {
    atomGlobalSpectrumData,
    atomSelectedLibrary,
} from "../Global/Atoms";
import { useRequest } from "ahooks";
import { Parser } from "@json2csv/plainjs";

const atomSearchScore = atom([]);

const baseColumns = [
    {
        title: 'Delta mass',
        dataIndex: 'delta_mz',
        key: 'delta_mz',
        sorter: (a, b) => compareValues(a.delta_mz, b.delta_mz),
        ellipsis: false,
        width: 110,
        render: (_, record) => formatValue(record.delta_mz),
    }, {
        title: 'Score',
        dataIndex: 'score',
        key: 'score',
        sorter: (a, b) => compareValues(a.score, b.score),
        defaultSortOrder: 'descend',
        ellipsis: false,
        width: 110,
        render: (_, record) => formatValue(record.score),
    },
];


////////////////////////////////////////////////////////////////////////////////
// Helpers for grouping (plain JavaScript, no React)
// Numbers are shown with 3 decimals
const FIXED_DECIMALS = ["precursor_mz", "delta_mz", "score"];

const isEmpty = (v) => v === undefined || v === null || v === "";

// Plain numbers, and strings that are entirely a decimal number ("12.5", "1e-3"), count as numbers
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const toNumber = (v) => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && NUMBER_PATTERN.test(v.trim())) return Number(v);
    return NaN;
};

// Summarise the values of one field inside one group. It is only run when length is larger than 1. So it is also a flag that it is a group. 
const summarize = (values) => {
    const nonEmptyValues = values.filter(v => !isEmpty(v));
    if (nonEmptyValues.length === 0) {
        return { __summary: true, type: "empty" };
    }
    const numbers = nonEmptyValues.map(toNumber);
    if (numbers.every(n => !Number.isNaN(n))) {
        let min = Infinity;
        let max = -Infinity;
        for (const v of numbers) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
        return { __summary: true, type: "range", min: min, max: max };
    }
    const seen = new Set();
    const unique = [];
    for (const v of nonEmptyValues) {
        const text = typeof v === "object" ? JSON.stringify(v) : String(v);
        if (!seen.has(text)) {
            seen.add(text);
            unique.push(text);
        }
    }
    return { __summary: true, type: "set", values: unique };
};

// If not yet a summary, summarize. Else just return the summary.
const toSummary = (v) => (v && v.__summary) ? v : summarize([v]);

// Extra metadata can be strings, numbers, arrays etc. and a group holds a summary,
// so render it defensively.
const formatValue = (v) => {
    const s = toSummary(v);
    if (s.type === "empty") return "";
    if (s.type === "range") {
        return s.min === s.max ? s.min.toFixed(3) : `${s.min.toFixed(3)} – ${s.max.toFixed(3)}`;
    }
    return s.values.join(", ");
};

// Sort ranges by their maximum, everything else as text
const compareValues = (a, b) => {
    const sa = toSummary(a);
    const sb = toSummary(b);
    if (sa.type === "range" && sb.type === "range") {
        return sa.max - sb.max;
    }
    return formatValue(a).localeCompare(formatValue(b), undefined, { numeric: true });
};

// Combine rows that share the same value in `groupBy` into one row.
// A group with several rows gets those rows as `children` (and shows them as
// expandable sub-rows). Rows without a value to group on stay on their own row.
const groupRows = (rows, groupBy, fields) => {
    // Check if a metadata keys to group on is selected otherwise just show rows as normal.
    if (!groupBy) {
        return rows;
    }
    const groups = new Map();
    rows.forEach(row => {
        const value = row[groupBy];
        const key = isEmpty(value) ? "row:" + row.key : "group:" + JSON.stringify(value);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(row);
    });
    return Array.from(groups, ([key, members]) => {
        if (members.length === 1) {
            return { ...members[0], count: 1 };
        }
        const groupRow = { key: key, count: members.length, children: members };
        fields.forEach(field => {
            groupRow[field] = summarize(members.map(m => m[field]));
        });
        return groupRow;
    });
};

// The text a table shows, as one object per row (used for the CSV export of grouped results)
const tableToText = (rows, columns) => rows.map(row => {
    const out = {};
    columns.forEach(c => {
        out[c.title] = c.key === "count" ? (row.count ?? "") : formatValue(row[c.key]);
    });
    return out;
});

export default () => {
    const [getAtomGlobalSpectrum,] = useAtom(atomGlobalSpectrumData);
    const [getAtomSearchScore, setAtomSearchScore] = useAtom(atomSearchScore);
    const [getAtomSelectedLibrary, setAtomSelectedLibrary] = useAtom(atomSelectedLibrary);


    ////////////////////////////////////////////////////////////////////////////////
    // For search type
    const [stateSearchType, setStateSearchType] = useState("identity_search");
    // For selected library spectrum
    const [stateSelectedLibrarySpectrum, setStateSelectedLibrarySpectrum] = useState("");

    ////////////////////////////////////////////////////////////////////////////////
    // Load entropy search score
    useEffect(() => {
        setAtomSearchScore({
            identity_search: getAtomGlobalSpectrum.identity_search || [],
            open_search: getAtomGlobalSpectrum.open_search || [],
            neutral_loss_search: getAtomGlobalSpectrum.neutral_loss_search || [],
            hybrid_search: getAtomGlobalSpectrum.hybrid_search || [],
        });
    }, [getAtomGlobalSpectrum]);

    ////////////////////////////////////////////////////////////////////////////////
    // Which extra metadata fields exist on the current result set, and which
    // of them the user has chosen to show as extra columns.
    const stateAvailableFields = useMemo(() => {
        const rows = getAtomSearchScore[stateSearchType] || [];
        const fieldSet = new Set();
        rows.forEach(([libSpec]) => {
            Object.keys(libSpec || {}).forEach(k => fieldSet.add(k));
        });
        return Array.from(fieldSet).sort();
    }, [getAtomSearchScore, stateSearchType]);

    const [stateSelectedFields, setStateSelectedFields] = useState(["precursor_mz"]);

    // Field to group on. Ignored if the current results do not have that field.
    const [stateGroupBy, setStateGroupBy] = useState(undefined);
    const groupBy = stateAvailableFields.includes(stateGroupBy) ? stateGroupBy : undefined;

    ////////////////////////////////////////////////////////////////////////////////
    const createColumn = (field) => ({
        title: field.replace(/^library-/, ""),
        dataIndex: field,
        key: field,
        ellipsis: true,
        width: 150,
        render: (_, record) => formatValue(record[field]),
        sorter: (a, b) => compareValues(a[field], b[field]),
    });
    const columns = useMemo(() => [
        // If groupby is set add the groupby column and a count column
        ...(groupBy ? [{
            title: groupBy.replace(/^library-/, ""),
            dataIndex: groupBy,
            key: groupBy,
            ellipsis: true,
            width: 150,
            render: (_, record) => formatValue(record[groupBy]),
            sorter: (a, b) => compareValues(a[groupBy], b[groupBy]),
        }, {
            title: 'Count',
            key: 'count',
            width: 70,
            render: (_, record) => record.count ?? "",
            sorter: (a, b) => (a.count ?? 0) - (b.count ?? 0),
        }] : []),
        ...baseColumns,

        ...stateSelectedFields
            .filter(field => field !== groupBy)
            .map(createColumn),

    ], [stateSelectedFields, groupBy]);

    ////////////////////////////////////////////////////////////////////////////////
    // Generate table data
    // For table data
    const [stateTableData, setStateTableData] = useState(null);
    useEffect(() => {
        const currentSearchScore = getAtomSearchScore[stateSearchType] || [];
        if (currentSearchScore.length > 0) {
            // The group field is needed on every row, even if it is not shown as a column
            const fields = groupBy ? [...stateSelectedFields, groupBy] : stateSelectedFields;
            const tableData = currentSearchScore.map((info, index) => {
                const row = {};
                fields.forEach(field => {
                    row[field] = info[0][field];
                });
                row["key"] = `${index}`
                row["score"] = info[1]
                row["delta_mz"] = info[0].precursor_mz - getAtomGlobalSpectrum.precursor_mz
                row["idx"] = info[0]["library-idx"]
                return row;
            });
            console.log(tableData);
            setStateTableData(groupRows(tableData, groupBy, [...FIXED_DECIMALS, ...fields]));
        } else {
            setStateTableData([])
        }
    }, [getAtomSearchScore, stateSearchType, stateSelectedFields, groupBy])

    // Which groups are open. Collapse everything when the results or the grouping change.
    const [stateExpandedKeys, setStateExpandedKeys] = useState([]);
    useEffect(() => {
        setStateExpandedKeys([]);
    }, [getAtomSearchScore, stateSearchType, groupBy]);

    const [stateTextFile, setStateTextFile] = useState(null);
    useEffect(() => {
        if (stateTableData && stateTableData.length > 0) {
            const parser = new Parser();
            // Grouped results contain summaries, so export the text the table shows
            const csv = parser.parse(groupBy ? tableToText(stateTableData, columns) : stateTableData);
            const data = new Blob([csv], { type: 'text/plain' });
            if (stateTextFile !== null) {
                window.URL.revokeObjectURL(stateTextFile);
            }
            const textFile = window.URL.createObjectURL(data);
            setStateTextFile(textFile);
        }
    }, [stateTableData]);

    return <>
        <Row>
            <Col span={24}>
                <Tabs defaultActiveKey="identity_search" centered onChange={(k) => setStateSearchType(k)}
                    items={[{
                        key: "identity_search", label: "Identity search",
                        disabled: ((getAtomSearchScore || {}).identity_search || []).length === 0
                    }, {
                        key: "open_search", label: "Open search",
                        disabled: ((getAtomSearchScore || {}).open_search || []).length === 0
                    }, {
                        key: "neutral_loss_search", label: "Neutral loss search",
                        disabled: ((getAtomSearchScore || {}).neutral_loss_search || []).length === 0
                    }, {
                        key: "hybrid_search", label: "Hybrid search",
                        disabled: ((getAtomSearchScore || {}).hybrid_search || []).length === 0
                    }]} />
                <Select
                    allowClear
                    showSearch
                    style={{ width: '100%', marginTop: 8 }}
                    placeholder="Group by (no grouping)"
                    value={groupBy}
                    onChange={setStateGroupBy}
                    options={stateAvailableFields.map(f => ({
                        label: f.replace(/^library-/, ""),
                        value: f,
                    }))}
                />
                <Select
                    mode="multiple"
                    allowClear
                    style={{ width: '100%', marginBottom: 8, marginTop: 8 }}
                    placeholder="Add metadata columns"
                    value={stateSelectedFields}
                    onChange={setStateSelectedFields}
                    options={stateAvailableFields.map(f => ({
                        label: f.replace(/^library-/, ""),
                        value: f,
                    }))}
                />
                <VirtualTable
                    vid={"spectra-result-table"}
                    // loading={stateScanData.status === "loading"}
                    expandable={{
                        expandRowByClick: true,
                        expandedRowKeys: stateExpandedKeys,
                        onExpandedRowsChange: setStateExpandedKeys,
                    }}
                    onRow={record => ({
                        onClick: event => {
                            console.log(record);
                            // A group row (it has children) only expands. Any other row selects its library spectrum.
                            if (record.children) {
                                return;
                            }
                            setAtomSelectedLibrary({ charge: 0, idx: record.idx });
                        },
                    })}
                    rowClassName={record => {
                        return (stateSelectedLibrarySpectrum === `${record.key}`) ? "row-active" : "";
                    }}
                    height={300}
                    size={'small'}
                    columns={columns} dataSource={stateTableData} />
            </Col>
        </Row>
        <Row justify="end">
            <>
                {
                    stateTextFile ? <>
                        <Button type={"dashed"} href={stateTextFile} download="result-library_matching.csv" >Export library matching results</Button>
                    </> : <></>
                }
            </>
        </Row>
    </>;
};