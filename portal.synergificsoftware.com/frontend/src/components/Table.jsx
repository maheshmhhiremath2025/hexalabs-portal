import React, { useState } from 'react';
import { FaTrash, FaPlus, FaSearch, FaChevronUp, FaChevronDown } from 'react-icons/fa';

const getNestedValue = (obj, path) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

const Table = ({ data, Search, modalVisible, deleteData, title, header, columns = [] }) => {
    const [sortCol, setSortCol] = useState(null);
    const [sortDir, setSortDir] = useState('asc');
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

            <div className="overflow-x-auto">
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
                        {sortedData.length > 0 ? (
                            sortedData.map((item, index) => (
                                <tr key={index} className="hover:bg-surface-50/50 transition-colors">
                                    <td className="py-2.5 px-4 text-surface-500 text-xs tabular-nums">{index + 1}</td>
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
        </div>
    );
};

export default Table;
