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
        title: 'Precursor m/z',
        dataIndex: 'precursor_mz',
        key: 'precursor_mz',
        sorter: (a, b) => a.precursor_mz - b.precursor_mz,
        ellipsis: false,
        width: 80,
        render: (_, record) => record.precursor_mz.toFixed(3),
    }, {
        title: 'Delta mass',
        dataIndex: 'delta_mz',
        key: 'delta_mz',
        sorter: (a, b) => a.delta_mz - b.delta_mz,
        ellipsis: false,
        width: 80,
        render: (_, record) => record.delta_mz.toFixed(3),
    }, {
        title: 'Score',
        dataIndex: 'score',
        key: 'score',
        sorter: (a, b) => a.score - b.score,
        defaultSortOrder: 'descend',
        ellipsis: false,
        width: 60,
        render: (_, record) => record.score.toFixed(3),
    },
];

// Fields that already have a dedicated fixed column, so we don't offer
// them again in the "extra metadata" picker.
const FIXED_FIELDS = ["precursor_mz"];

// Summarise the values of one field inside one group. It is only run when length is larger than 1. So it is also a flag that it is a group. 
const summarize = (values) => {
    const nonEmptyValues = values.filter(v => !isEmpty(v));
    if (nonEmptyValues.length === 0) {
        return { __summary: true, type: "empty" };
    }
    if (nonEmptyValues.every(v => typeof v === "number")) {
        let min = Infinity;
        let max = -Infinity;
        for (const v of nonEmptyValues) {
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
        FIXED_FIELDS.forEach(k => fieldSet.delete(k));
        return Array.from(fieldSet).sort();
    }, [getAtomSearchScore, stateSearchType]);

    const [stateSelectedFields, setStateSelectedFields] = useState([]);

    // Field to group on. Ignored if the current results do not have that field.
    const [stateGroupBy, setStateGroupBy] = useState(undefined);
    const groupBy = stateAvailableFields.includes(stateGroupBy) ? stateGroupBy : undefined;

    ////////////////////////////////////////////////////////////////////////////////
    // Fixed columns plus one column per selected extra field
    const columns = useMemo(() => [
        ...baseColumns,
        ...stateSelectedFields.map(field => ({
            title: field.replace(/^library-/, ""),
            dataIndex: field,
            key: field,
            ellipsis: true,
            width: 150,
            render: (_, record) => formatValue(record[field]),
            sorter: (a, b) => String(a[field] ?? "").localeCompare(
                String(b[field] ?? ""), undefined, { numeric: true }
            ),
        })),
    ], [stateSelectedFields]);

    ////////////////////////////////////////////////////////////////////////////////
    // Generate table data
    // For table data
    const [stateTableData, setStateTableData] = useState(null);
    useEffect(() => {
        const currentSearchScore = getAtomSearchScore[stateSearchType] || [];
        if (currentSearchScore.length > 0) {
            const tableData = currentSearchScore.map((info, index) => {
                const row = {
                    key: `${index}`,
                    score: info[1],
                    delta_mz: info[0].precursor_mz - getAtomGlobalSpectrum.precursor_mz,

                    precursor_mz: info[0].precursor_mz,
                    idx: info[0]["library-idx"],
                    charge: getAtomGlobalSpectrum.charge
                };
                stateSelectedFields.forEach(field => {
                    row[field] = info[0][field];
                });
                return row;
            });
            console.log(tableData);
            setStateTableData(tableData);
        } else {
            setStateTableData([])
        }
    }, [getAtomSearchScore, stateSearchType, stateSelectedFields])

    const [stateTextFile, setStateTextFile] = useState(null);
    useEffect(() => {
        if (stateTableData && stateTableData.length > 0) {
            const parser = new Parser();
            const csv = parser.parse(stateTableData);
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
                    onRow={record => ({
                        onClick: event => {
                            console.log(record);
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