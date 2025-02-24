import React from 'react';
import { useQuery, getDataModels } from 'wasp/client/operations';
import { Link } from 'wasp/client/router';

const DashboardPage = () => {
  const { data: dataModels, isLoading, error } = useQuery(getDataModels);

  if (isLoading) return 'Loading...';
  if (error) return 'Error: ' + error;

  return (
    <div className='p-4 bg-gray-50 h-full'>
      <div className='flex justify-between items-center mb-6'>
        <h1 className='text-2xl font-bold'>Data Models</h1>
        <Link
          to='/data-model/new'
          className='bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded flex items-center'
        >
          <span className='text-xl mr-1'>+</span> New Model
        </Link>
      </div>

      <div className='mb-6'>
        {dataModels?.length > 0 ? (
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
            {dataModels.map((model) => (
              <Link
                key={model.id}
                to={`/data-model/${model.id}`}
                className='block p-4 border rounded-lg hover:shadow-lg transition-shadow bg-white'
              >
                <h3 className='text-lg font-semibold'>{model.name}</h3>
                <p className='text-gray-600'>Version {model.version}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className='text-center py-12'>
            <p className='text-gray-600 mb-4'>You haven't created any data models yet</p>
            <Link
              to='/data-model/new'
              className='bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded inline-flex items-center'
            >
              Create Your First Model
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
