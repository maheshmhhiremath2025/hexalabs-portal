import React, { useState } from 'react';
import { FaTrash, FaPlus, FaSearch, FaChevronUp, FaChevronDown, FaChevronLeft, FaChevronRight } from 'react-icons/fa';

const getNestedValue = (obj, path) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

const Table = ({ data, Search, modalVisible, deleteData, title, header, columns = [] }) => {
    const [sortCol, setSortCol] = useState(null);
    const [sortDir, setSortDir] = useState('asc');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(5);
    const isObjectData = data.length > 0 && typeof data[0] === 'object';

    const handleSort = (colIndex) => {
        if (sortCol === colIndex) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortCol(colIndex);
            setSortDir('asc');
        }
    };

    const sortedData = [...data].sort((a, b) => {
        if (sortCol === null || !isObjectData) return 0;
        const path = columns[sortCol - 1];
        if (!path) return 0;
        const va = getNestedValue(a, path) ?? '';
        const vb = getNestedValue(b, path) ?? '';
        const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
    });

    // Pagination
    const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const pageData = sortedData.slice(startIdx, startIdx + pageSize);

    // Reset to page 1 when data changes
    React.useEffect(() => { setPage(1); }, [data.length]);

    return (
        <div className="card overflow-hidden">
            <div className="card-header">
                <h3 className="text-sm font-semibold text-surface-800">{title}</h3>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 text-xs" />
                        <input
                            type="text"
                            placeholder="Search..."
                            className="text-sm pl-8 pr-3 py-1.5 border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-surface-50 w-44"
                            onChange={(e) => Search(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={() => modalVisible(true)}
                        className="btn-primary py-1.5 px-3 text-xs"
                        title={`Add ${title}`}
                    >
                        <FaPlus className="text-[10px]" />
                        Add
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="bg-surface-50 border-b border-surface-200">
                            {header.map((value, index) => (
                                <th
                                    key={index}
                                    className="py-2.5 px-4 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider cursor-pointer hover:text-surface-700 select-none"
                                    onClick={() => handleSort(index)}
                                >
                                    <span className="inline-flex items-center gap-1">
                                        {value}
                                        {sortCol === index && (
                                            sortDir === 'asc' ? <FaChevronUp className="text-[8px]" /> : <FaChevronDown className="text-[8px]" />
                                        )}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                        {pageData.length > 0 ? (
                            pageData.map((item, index) => (
                                <tr key={index} className="hover:bg-surface-50/50 transition-colors">
                                    <td className="py-2.5 px-4 text-surface-500 text-xs tabular-nums">{startIdx + index + 1}</td>
                                    {isObjectData ? (
                                        columns.map((colPath, colIndex) => (
                                            <td key={colIndex} className="py-2.5 px-4 text-surface-700">
                                                {getNestedValue(item, colPath) ?? <span className="text-surface-300">-</span>}
                                            </td>
                                        ))
                                    ) : (
                                        <td className="py-2.5 px-4 text-surface-700">{item}</td>
                                    )}
                                    <td className="py-2.5 px-4">
                                        <button
                                            onClick={() => deleteData(item)}
                                            className="p-1.5 text-surface-400 hover:text-danger hover:bg-red-50 rounded-md transition-colors"
                                            title="Delete"
                                        >
                                            <FaTrash className="text-xs" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={header.length} className="text-center py-10 text-surface-400 text-sm">
                                    No {title.toLowerCase()} found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {sortedData.length > 5 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-surface-200 bg-surface-50/50">
                    <div className="flex items-center gap-2 text-xs text-surface-500">
                        <span>Showing {startIdx + 1}-{Math.min(startIdx + pageSize, sortedData.length)} of {sortedData.length}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => { setPageSize(+e.target.value); setPage(1); }}
                            className="px-2 py-1 border border-surface-200 rounded text-xs bg-white focus:outline-none"
                        >
                            {PAGE_SIZE_OPTIONS.map(s => (
                                <option key={s} value={s}>{s} per page</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setPage(1)}
                            disabled={safePage === 1}
                            className="px-2 py-1 text-xs text-surface-600 hover:bg-surface-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            First
                        </button>
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={safePage === 1}
                            className="p-1.5 text-surface-600 hover:bg-surface-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <FaChevronLeft className="text-[10px]" />
                        </button>
                        {/* Page numbers */}
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let pageNum;
                            if (totalPages <= 5) {
                                pageNum = i + 1;
                            } else if (safePage <= 3) {
                                pageNum = i + 1;
                            } else if (safePage >= totalPages - 2) {
                                pageNum = totalPages - 4 + i;
                            } else {
                                pageNum = safePage - 2 + i;
                            }
                            return (
                                <button
                                    key={pageNum}
                                    onClick={() => setPage(pageNum)}
                                    className={`px-2.5 py-1 text-xs rounded transition-colors ${
                                        safePage === pageNum
                                            ? 'bg-blue-600 text-white'
                                            : 'text-surface-600 hover:bg-surface-200'
                                    }`}
                                >
                                    {pageNum}
                                </button>
                            );
                        })}
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={safePage === totalPages}
                            className="p-1.5 text-surface-600 hover:bg-surface-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <FaChevronRight className="text-[10px]" />
                        </button>
                        <button
                            onClick={() => setPage(totalPages)}
                            disabled={safePage === totalPages}
                            className="px-2 py-1 text-xs text-surface-600 hover:bg-surface-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            Last
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Table;
